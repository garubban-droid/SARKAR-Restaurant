import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const {Pool}=pg;
const app=express();
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:false}:false});
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const publicDir=path.join(__dirname,"public");

async function initDatabase(){
  const fs = await import('node:fs/promises');
  const schemaPath = path.join(__dirname,'schema.sql');
  const schema = await fs.readFile(schemaPath,'utf8');
  await pool.query(schema);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS dob DATE`);
  await pool.query(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS full_address TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS pin_code TEXT NOT NULL DEFAULT ''`);

await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_latitude DOUBLE PRECISION`);
await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_longitude DOUBLE PRECISION`);
  if(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD){
    const email=String(process.env.ADMIN_EMAIL).trim().toLowerCase();
    const hash=await bcrypt.hash(String(process.env.ADMIN_PASSWORD),12);
    await pool.query('INSERT INTO admins(email,password_hash) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash',[email,hash]);
    console.log('Admin user initialized:', email);
  }
  if(process.env.RIDER_PHONE && process.env.RIDER_PASSWORD){
    const phone=cleanPhone(process.env.RIDER_PHONE);
    const name=String(process.env.RIDER_NAME||'SARKAR Rider').trim();
    const hash=await bcrypt.hash(String(process.env.RIDER_PASSWORD),12);
    await pool.query('INSERT INTO riders(name,phone,password_hash) VALUES($1,$2,$3) ON CONFLICT(phone) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,active=true',[name,phone,hash]);
    console.log('Rider user initialized:', phone);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS customer_order_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT UNIQUE NOT NULL,
    customer_id UUID,
    product_id UUID,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_order_ratings_product ON customer_order_ratings(product_id)`);
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS referral_code TEXT`);
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS referred_by_customer_id UUID`);
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS device_fingerprint_hash TEXT`);
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS signup_ip_hash TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS customers_referral_code_idx ON customers(referral_code) WHERE referral_code IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS customers_device_hash_idx ON customers(device_fingerprint_hash) WHERE device_fingerprint_hash IS NOT NULL`);

  await pool.query(`CREATE TABLE IF NOT EXISTS referral_settings (
    id INTEGER PRIMARY KEY CHECK (id=1),
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`INSERT INTO referral_settings(id,data) VALUES(1,'{}') ON CONFLICT(id) DO NOTHING`);

  await pool.query(`CREATE TABLE IF NOT EXISTS customer_referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    referred_customer_id UUID NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
    referral_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','REWARDED','REJECTED')),
    reward_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    device_match BOOLEAN NOT NULL DEFAULT false,
    multiple_account_signal BOOLEAN NOT NULL DEFAULT false,
    spam_signal BOOLEAN NOT NULL DEFAULT false,
    ip_match BOOLEAN NOT NULL DEFAULT false,
    fraud_note TEXT NOT NULL DEFAULT '',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    qualified_at TIMESTAMPTZ,
    rewarded_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS customer_referrals_referrer_idx ON customer_referrals(referrer_customer_id,joined_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS customer_referrals_status_idx ON customer_referrals(status,joined_at DESC)`);

  await pool.query(`CREATE TABLE IF NOT EXISTS referral_fraud_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referral_id UUID REFERENCES customer_referrals(id) ON DELETE SET NULL,
    referred_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    signal_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'MEDIUM',
    details TEXT NOT NULL DEFAULT '',
    device_hash TEXT,
    ip_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS referral_fraud_signals_time_idx ON referral_fraud_signals(created_at DESC)`);

  await pool.query(`CREATE TABLE IF NOT EXISTS customer_wallets (
    customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    promotional_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    reference_type TEXT NOT NULL DEFAULT '',
    reference_id TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS wallet_referral_once_idx ON wallet_transactions(reference_type,reference_id) WHERE reference_type='REFERRAL' AND reference_id<>''`);

  const defaultReferralSettings={
    enabled:true,rewardType:'PROMOTIONAL_BALANCE',rewardAmount:50,minOrderAmount:0,
    qualifyingEvent:'FIRST_ORDER_DELIVERED',blockSameDevice:true,flagMultipleAccounts:true,
    spamDetection:true,spamThreshold24h:3,codePrefix:'SARKAR',maxReferralsPerCustomer:null
  };
  await pool.query(`UPDATE referral_settings SET data=$1,updated_at=now() WHERE id=1 AND (data='{}'::jsonb OR data IS NULL)`,[JSON.stringify(defaultReferralSettings)]);

  async function ensureReferralCode(customerId, phone){
    for(let i=0;i<8;i++){
      const code=`SARKAR${crypto.randomInt(100000,999999)}`;
      try{
        const r=await pool.query(`UPDATE customers SET referral_code=$1,updated_at=now() WHERE id=$2 AND (referral_code IS NULL OR referral_code='') RETURNING referral_code`,[code,customerId]);
        if(r.rowCount)return r.rows[0].referral_code;
      }catch(e){ if(e.code!=='23505') throw e; }
    }
    throw new Error('Referral code generation failed');
  }
  const existingCustomers=await pool.query(`SELECT id,phone FROM customers WHERE referral_code IS NULL OR referral_code=''`);
  for(const c of existingCustomers.rows){ try{await ensureReferralCode(c.id,c.phone)}catch(e){console.warn('Referral code init failed',c.id,e.message)} }

  console.log('Database schema initialized successfully.');
}
const allowedStatuses=new Set(['NEW','ACCEPTED','PREPARING','READY','OUT_FOR_DELIVERY','DELIVERED','CANCELLED']);
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:false}));
app.use(cors({origin:process.env.CORS_ORIGIN?.split(',').map(x=>x.trim())||false}));
app.use(express.json({limit:'1mb',verify:(req,res,buf)=>{if(req.originalUrl==='/api/payments/razorpay/webhook')req.rawBody=Buffer.from(buf)}}));
app.use('/api/auth',rateLimit({windowMs:15*60*1000,max:20,standardHeaders:true,legacyHeaders:false}));
app.use('/api/orders',rateLimit({windowMs:60*1000,max:60,standardHeaders:true,legacyHeaders:false}));
app.use(express.static(publicDir));
const q=(text,params=[])=>pool.query(text,params);
function auth(req,res,next){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return res.status(401).json({error:'Unauthorized'});req.admin=jwt.verify(h.slice(7),process.env.JWT_SECRET);next()}catch{return res.status(401).json({error:'Unauthorized'})}}
function customerAuth(req,res,next){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return res.status(401).json({error:'Customer login required'});const p=jwt.verify(h.slice(7),process.env.JWT_SECRET);if(p.scope!=='customer')throw Error();req.customer=p;next()}catch{return res.status(401).json({error:'Customer login required'})}}
function customerBearer(req){const h=req.headers.authorization||'';return h.startsWith('Bearer ')?h.slice(7):''}
function riderAuth(req,res,next){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return res.status(401).json({error:'Rider login required'});const p=jwt.verify(h.slice(7),process.env.JWT_SECRET);if(p.scope!=='rider')throw Error();req.rider=p;next()}catch{return res.status(401).json({error:'Rider login required'})}}
function riderBearer(req){const h=req.headers.authorization||'';return h.startsWith('Bearer ')?h.slice(7):''}
function normalizeCoupon(v){return String(v||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,40)}
async function calculateCoupon(code,subtotal,deliveryFee){
  const c=normalizeCoupon(code); if(!c)return {code:null,discount:0,coupon:null};
  const r=await q('SELECT * FROM coupons WHERE code=$1 AND active=true AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>=now())',[c]);
  if(!r.rowCount)return {error:'কুপন কোড সঠিক নয় বা বর্তমানে সক্রিয় নয়'};
  const x=r.rows[0]; if(Number(subtotal)<Number(x.min_order))return {error:`এই কুপনের জন্য ন্যূনতম অর্ডার ₹${Number(x.min_order)}`};
  if(x.usage_limit!=null && Number(x.used_count)>=Number(x.usage_limit))return {error:'এই কুপনের ব্যবহার সীমা শেষ'};
  let discount=0;
  if(x.discount_type==='PERCENT') discount=Number(subtotal)*Number(x.discount_value)/100;
  else if(x.discount_type==='FIXED') discount=Number(x.discount_value);
  else if(x.discount_type==='FREE_DELIVERY') discount=Number(deliveryFee);
  if(x.max_discount!=null) discount=Math.min(discount,Number(x.max_discount));
  discount=Math.max(0,Math.min(discount,Number(subtotal)+Number(deliveryFee)));
  return {code:x.code,discount:+discount.toFixed(2),coupon:x};
}
function cleanPhone(v){return String(v||'').replace(/[^0-9+]/g,'').slice(0,20)}
function tokenHash(v){return crypto.createHash('sha256').update(String(v||'')).digest('hex')}
function hashSignal(v){return tokenHash(String(v||'')+'|'+String(process.env.JWT_SECRET||'SARKAR'))}
const DEFAULT_REFERRAL_SETTINGS={enabled:true,rewardType:'PROMOTIONAL_BALANCE',rewardAmount:50,minOrderAmount:0,qualifyingEvent:'FIRST_ORDER_DELIVERED',blockSameDevice:true,flagMultipleAccounts:true,spamDetection:true,spamThreshold24h:3,codePrefix:'SARKAR',maxReferralsPerCustomer:null};
async function getReferralSettings(){
  const r=await q('SELECT data FROM referral_settings WHERE id=1');
  return {...DEFAULT_REFERRAL_SETTINGS,...(r.rows[0]?.data||{})};
}
async function makeReferralCode(prefix='SARKAR'){
  const p=String(prefix||'SARKAR').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12)||'SARKAR';
  for(let i=0;i<20;i++){
    const code=p+String(crypto.randomInt(100000,999999));
    const r=await q('SELECT 1 FROM customers WHERE referral_code=$1',[code]);
    if(!r.rowCount)return code;
  }
  throw new Error('Unable to generate unique referral code');
}
async function ensureCustomerReferralCode(customerId){
  const r=await q('SELECT referral_code FROM customers WHERE id=$1',[customerId]);
  if(!r.rowCount)return null;
  if(r.rows[0].referral_code)return r.rows[0].referral_code;
  const code=await makeReferralCode((await getReferralSettings()).codePrefix);
  await q('UPDATE customers SET referral_code=$1,updated_at=now() WHERE id=$2 AND (referral_code IS NULL OR referral_code=\'\')',[code,customerId]);
  return code;
}
async function maybeRewardReferral(client, customerId, orderId, orderTotal){
  if(!customerId)return;
  const settings={...DEFAULT_REFERRAL_SETTINGS,...((await client.query('SELECT data FROM referral_settings WHERE id=1')).rows[0]?.data||{})};
  if(!settings.enabled || settings.qualifyingEvent!=='FIRST_ORDER_DELIVERED')return;
  const ref=await client.query(`SELECT cr.*,c.phone AS referred_phone
    FROM customer_referrals cr JOIN customers c ON c.id=cr.referred_customer_id
    WHERE cr.referred_customer_id=$1 AND cr.status='PENDING' FOR UPDATE`,[customerId]);
  if(!ref.rowCount)return;
  const x=ref.rows[0];
  if(Number(orderTotal||0)<Number(settings.minOrderAmount||0))return;
  const prior=await client.query(`SELECT COUNT(*)::int AS n FROM orders WHERE customer_id=$1 AND status='DELIVERED' AND id<>$2`,[customerId,orderId]);
  if(Number(prior.rows[0]?.n||0)>0)return;
  if(x.device_match && settings.blockSameDevice)return;
  if(x.spam_signal && settings.spamDetection)return;
  const reward=Math.max(0,Number(settings.rewardAmount)||0);
  await client.query(`INSERT INTO customer_wallets(customer_id,promotional_balance,updated_at)
    VALUES($1,$2,now()) ON CONFLICT(customer_id) DO UPDATE SET promotional_balance=customer_wallets.promotional_balance+EXCLUDED.promotional_balance,updated_at=now()`,[x.referrer_customer_id,reward]);
  await client.query(`INSERT INTO wallet_transactions(customer_id,type,amount,reference_type,reference_id,note)
    VALUES($1,'REFERRAL_REWARD',$2,'REFERRAL',$3,$4)
    ON CONFLICT(reference_type,reference_id) DO NOTHING`,[x.referrer_customer_id,reward,String(x.id),`Referral reward for ${x.referral_code}`]);
  await client.query(`UPDATE customer_referrals SET status='REWARDED',reward_amount=$1,qualified_at=now(),rewarded_at=now() WHERE id=$2`,[reward,x.id]);
}

function razorConfigured(){return !!(process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET)}
function timingSafeEqualHex(a,b){try{const aa=Buffer.from(a,'hex'),bb=Buffer.from(b,'hex');return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)}catch{return false}}
async function notify(event,payload){const url=process.env.NOTIFICATION_WEBHOOK_URL;if(!url)return;try{await fetch(url,{method:'POST',headers:{'content-type':'application/json',...(process.env.NOTIFICATION_WEBHOOK_SECRET?{'x-webhook-secret':process.env.NOTIFICATION_WEBHOOK_SECRET}:{})},body:JSON.stringify({event,payload})})}catch(e){console.warn('Notification webhook failed',e.message)}}
function bearer(req){const h=req.headers.authorization||'';return h.startsWith('Bearer ')?h.slice(7):''}
app.get('/api/health',async(_,res)=>{try{await q('SELECT 1');res.json({ok:true})}catch{res.status(503).json({ok:false})}});
app.post('/api/auth/login',async(req,res)=>{const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');if(!email||!password)return res.status(400).json({error:'Email and password are required'});const r=await q('SELECT * FROM admins WHERE email=$1',[email]);if(!r.rowCount||!(await bcrypt.compare(password,r.rows[0].password_hash)))return res.status(401).json({error:'Invalid credentials'});const token=jwt.sign({sub:r.rows[0].id,email},process.env.JWT_SECRET,{expiresIn:'12h'});res.json({token})});
app.post('/api/customer/auth/signup',async(req,res)=>{
  const name=String(req.body.name||'').trim().slice(0,120),phone=cleanPhone(req.body.phone),password=String(req.body.password||''),email=String(req.body.email||'').trim().toLowerCase().slice(0,160);
  const referralCode=normalizeCoupon(req.body.referralCode);
  const deviceId=String(req.body.deviceId||'').trim().slice(0,180);
  if(!name||phone.length<10||password.length<6)return res.status(400).json({error:'Name, valid mobile and 6+ character password are required'});
  const exists=await q('SELECT id FROM customers WHERE phone=$1',[phone]); if(exists.rowCount)return res.status(409).json({error:'এই মোবাইল নম্বর দিয়ে account আগে থেকেই আছে'});
  const settings=await getReferralSettings();
  let referrer=null;
  if(referralCode){
    const rr=await q('SELECT id,phone,device_fingerprint_hash,signup_ip_hash FROM customers WHERE referral_code=$1',[referralCode]);
    if(!rr.rowCount)return res.status(400).json({error:'Referral code সঠিক নয়'});
    referrer=rr.rows[0];
    if(settings.maxReferralsPerCustomer!=null){
      const rc=await q(`SELECT COUNT(*)::int AS n FROM customer_referrals WHERE referrer_customer_id=$1 AND status<>'REJECTED'`,[referrer.id]);
      if(Number(rc.rows[0]?.n||0)>=Number(settings.maxReferralsPerCustomer))return res.status(400).json({error:'এই referral link-এর limit পূর্ণ হয়েছে'});
    }
  }
  const deviceHash=deviceId?hashSignal(deviceId+'|'+String(req.headers['user-agent']||'')):null;
const ipHash=hashSignal(req.ip||'');
const hash=await bcrypt.hash(password,12);
const client=await pool.connect();

try{
  await client.query('BEGIN');

  const code=await makeReferralCode(settings.codePrefix);

  const r=await client.query(
    `INSERT INTO customers(
      name,
      phone,
      email,
      password_hash,
      referral_code,
      referred_by_customer_id,
      device_fingerprint_hash,
      signup_ip_hash
    )
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id,name,phone,email,referral_code AS "referralCode"`,
    [
      name,
      phone,
      email||null,
      hash,
      code,
      referrer?.id||null,
      deviceHash,
      ipHash
    ]
  );

  const c=r.rows[0];
    if(referrer && settings.enabled){
      const sameDevice=!!(deviceHash && referrer.device_fingerprint_hash && deviceHash===referrer.device_fingerprint_hash);
      const sameIp=!!(ipHash && referrer.signup_ip_hash && ipHash===referrer.signup_ip_hash);
      const multi=!!(deviceHash && (await client.query('SELECT COUNT(*)::int AS n FROM customers WHERE device_fingerprint_hash=$1',[deviceHash])).rows[0]?.n>1);
      const spamCount=Number((await client.query(`SELECT COUNT(*)::int AS n FROM customer_referrals cr JOIN customers c ON c.id=cr.referred_customer_id WHERE (c.device_fingerprint_hash=$1 OR c.signup_ip_hash=$2) AND cr.joined_at>now()-interval '24 hours'`,[deviceHash,ipHash])).rows[0]?.n||0);
      const spam=spamCount>=Number(settings.spamThreshold24h||3);
      const rejected=(sameDevice&&settings.blockSameDevice)||(spam&&settings.spamDetection);
      const note=[sameDevice?'SAME_DEVICE':'',sameIp?'SAME_IP':'',multi?'MULTIPLE_ACCOUNTS':'',spam?'SPAM_PATTERN':''].filter(Boolean).join(', ');
      const ins=await client.query(`INSERT INTO customer_referrals(referrer_customer_id,referred_customer_id,referral_code,status,device_match,multiple_account_signal,spam_signal,ip_match,fraud_note)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [referrer.id,c.id,referralCode,rejected?'REJECTED':'PENDING',sameDevice,multi,spam,sameIp,note]);
      if(note){
        await client.query(`INSERT INTO referral_fraud_signals(referral_id,referred_customer_id,signal_type,severity,details,device_hash,ip_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,[ins.rows[0].id,c.id,rejected?'BLOCKED_REFERRAL':'REFERRAL_SIGNAL',rejected?'HIGH':'MEDIUM',note,deviceHash,ipHash]);
      }
    }
    await client.query('COMMIT');
    const token=jwt.sign({sub:c.id,scope:'customer',phone},process.env.JWT_SECRET,{expiresIn:'30d'});
    res.status(201).json({token,customer:c});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
});
app.post('/api/customer/auth/login',async(req,res)=>{
  const phone=cleanPhone(req.body.phone),password=String(req.body.password||''),deviceId=String(req.body.deviceId||'').trim().slice(0,180);
  const r=await q('SELECT * FROM customers WHERE phone=$1',[phone]);
  if(!r.rowCount||!(await bcrypt.compare(password,r.rows[0].password_hash)))return res.status(401).json({error:'মোবাইল নম্বর বা password সঠিক নয়'});
  const c=r.rows[0];
  if(!c.referral_code) c.referral_code=await ensureCustomerReferralCode(c.id);
  if(deviceId && !c.device_fingerprint_hash)await q('UPDATE customers SET device_fingerprint_hash=$1,updated_at=now() WHERE id=$2',[hashSignal((deviceId||'')+'|'+String(req.headers['user-agent']||'')),c.id]);
  const token=jwt.sign({sub:c.id,scope:'customer',phone:c.phone},process.env.JWT_SECRET,{expiresIn:'30d'});
  res.json({token,customer:{id:c.id,name:c.name,phone:c.phone,email:c.email,referralCode:c.referral_code}});
});
app.get('/api/customer/me',customerAuth,async(req,res)=>{const r=await q('SELECT id,name,phone,email,created_at AS "createdAt" FROM customers WHERE id=$1',[req.customer.sub]);if(!r.rowCount)return res.status(404).json({error:'Customer not found'});res.json(r.rows[0]);});
app.put('/api/customer/me',customerAuth,async(req,res)=>{const name=String(req.body.name||'').trim().slice(0,120),email=String(req.body.email||'').trim().toLowerCase().slice(0,160);if(!name)return res.status(400).json({error:'Name required'});const r=await q('UPDATE customers SET name=$1,email=$2,updated_at=now() WHERE id=$3 RETURNING id,name,phone,email',[name,email||null,req.customer.sub]);res.json(r.rows[0]);});
app.put('/api/customer/password',customerAuth,async(req,res)=>{const current=String(req.body.currentPassword||''),next=String(req.body.newPassword||'');if(current.length<6||next.length<6)return res.status(400).json({error:'Password কমপক্ষে 6 অক্ষরের হতে হবে'});const r=await q('SELECT password_hash FROM customers WHERE id=$1',[req.customer.sub]);if(!r.rowCount||!(await bcrypt.compare(current,r.rows[0].password_hash)))return res.status(400).json({error:'বর্তমান password সঠিক নয়'});const hash=await bcrypt.hash(next,12);await q('UPDATE customers SET password_hash=$1,updated_at=now() WHERE id=$2',[hash,req.customer.sub]);res.json({ok:true});});

app.get('/api/customer/referral',customerAuth,async(req,res)=>{
  try{
    const code=await ensureCustomerReferralCode(req.customer.sub);
    const settings=await getReferralSettings();
    const stats=await q(`SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status='REWARDED')::int AS rewarded,
      COUNT(*) FILTER (WHERE status='PENDING')::int AS pending,
      COUNT(*) FILTER (WHERE status='REJECTED')::int AS rejected,
      COALESCE(SUM(reward_amount) FILTER (WHERE status='REWARDED'),0)::numeric AS earned
      FROM customer_referrals WHERE referrer_customer_id=$1`,[req.customer.sub]);
    const wallet=await q(`SELECT promotional_balance FROM customer_wallets WHERE customer_id=$1`,[req.customer.sub]);
    const list=await q(`SELECT cr.id,cr.referral_code AS "referralCode",cr.status,cr.reward_amount AS "rewardAmount",cr.fraud_note AS "fraudNote",cr.joined_at AS "joinedAt",c.name AS "referredName",c.phone AS "referredPhone"
      FROM customer_referrals cr JOIN customers c ON c.id=cr.referred_customer_id
      WHERE cr.referrer_customer_id=$1 ORDER BY cr.joined_at DESC LIMIT 100`,[req.customer.sub]);
    const base=String(process.env.PUBLIC_BASE_URL||`https://${req.get('host')}`).replace(/\/$/,'');
    res.json({enabled:settings.enabled,referralCode:code,referralLink:`${base}/?ref=${encodeURIComponent(code)}`,rewardType:settings.rewardType,rewardAmount:Number(settings.rewardAmount||0),stats:stats.rows[0],promotionalBalance:Number(wallet.rows[0]?.promotional_balance||0),referrals:list.rows});
  }catch(e){res.status(500).json({error:'Referral data load failed'})}
});
app.get('/api/customer/referral-config',async(_,res)=>{const settings=await getReferralSettings();res.json({enabled:settings.enabled,rewardType:settings.rewardType,rewardAmount:Number(settings.rewardAmount||0),minOrderAmount:Number(settings.minOrderAmount||0),qualifyingEvent:settings.qualifyingEvent})});

app.get('/api/customer/addresses',customerAuth,async(req,res)=>{const r=await q('SELECT id,label,recipient_name AS "recipientName",phone,address,latitude,longitude,is_default AS "isDefault" FROM customer_addresses WHERE customer_id=$1 ORDER BY is_default DESC,created_at DESC',[req.customer.sub]);res.json(r.rows);});
app.post('/api/customer/addresses',customerAuth,async(req,res)=>{const label=String(req.body.label||'Home').trim().slice(0,40),recipientName=String(req.body.recipientName||'').trim().slice(0,120),phone=cleanPhone(req.body.phone||req.customer.phone),address=String(req.body.address||'').trim().slice(0,500),lat=req.body.latitude==null?null:Number(req.body.latitude),lng=req.body.longitude==null?null:Number(req.body.longitude),makeDefault=req.body.isDefault!==false;if(!recipientName||!phone||!address)return res.status(400).json({error:'Recipient, mobile and address are required'});if(makeDefault)await q('UPDATE customer_addresses SET is_default=false WHERE customer_id=$1',[req.customer.sub]);const r=await q('INSERT INTO customer_addresses(customer_id,label,recipient_name,phone,address,latitude,longitude,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,label,recipient_name AS "recipientName",phone,address,latitude,longitude,is_default AS "isDefault"',[req.customer.sub,label,recipientName,phone,address,Number.isFinite(lat)?lat:null,Number.isFinite(lng)?lng:null,makeDefault]);res.status(201).json(r.rows[0]);});
app.put('/api/customer/addresses/:id',customerAuth,async(req,res)=>{const address=String(req.body.address||'').trim().slice(0,500),label=String(req.body.label||'Home').trim().slice(0,40),recipientName=String(req.body.recipientName||'').trim().slice(0,120),phone=cleanPhone(req.body.phone||req.customer.phone),lat=req.body.latitude==null?null:Number(req.body.latitude),lng=req.body.longitude==null?null:Number(req.body.longitude),makeDefault=req.body.isDefault===true;if(!address||!recipientName)return res.status(400).json({error:'Address and recipient are required'});if(makeDefault)await q('UPDATE customer_addresses SET is_default=false WHERE customer_id=$1',[req.customer.sub]);const r=await q('UPDATE customer_addresses SET label=$1,recipient_name=$2,phone=$3,address=$4,latitude=$5,longitude=$6,is_default=$7,updated_at=now() WHERE id=$8 AND customer_id=$9 RETURNING id,label,recipient_name AS "recipientName",phone,address,latitude,longitude,is_default AS "isDefault"',[label,recipientName,phone,address,Number.isFinite(lat)?lat:null,Number.isFinite(lng)?lng:null,makeDefault,req.params.id,req.customer.sub]);if(!r.rowCount)return res.status(404).json({error:'Address not found'});res.json(r.rows[0]);});
app.delete('/api/customer/addresses/:id',customerAuth,async(req,res)=>{const r=await q('DELETE FROM customer_addresses WHERE id=$1 AND customer_id=$2',[req.params.id,req.customer.sub]);if(!r.rowCount)return res.status(404).json({error:'Address not found'});res.status(204).end();});
app.post('/api/coupons/validate',async(req,res)=>{const subtotal=Math.max(0,Number(req.body.subtotal)||0),deliveryFee=Math.max(0,Number(req.body.deliveryFee)||0);const r=await calculateCoupon(req.body.code,subtotal,deliveryFee);if(r.error)return res.status(400).json({error:r.error});res.json({valid:true,code:r.code,discount:r.discount,total:Math.max(0,subtotal+deliveryFee-r.discount)});});


app.get('/api/admin/referral-settings',auth,async(_,res)=>{
  const settings=await getReferralSettings(); res.json(settings);
});
app.put('/api/admin/referral-settings',auth,async(req,res)=>{
  const x=req.body||{};
  const data={
    enabled:x.enabled!==false,
    rewardType:'PROMOTIONAL_BALANCE',
    rewardAmount:Math.max(0,Number(x.rewardAmount)||0),
    minOrderAmount:Math.max(0,Number(x.minOrderAmount)||0),
    qualifyingEvent:'FIRST_ORDER_DELIVERED',
    blockSameDevice:x.blockSameDevice!==false,
    flagMultipleAccounts:x.flagMultipleAccounts!==false,
    spamDetection:x.spamDetection!==false,
    spamThreshold24h:Math.max(1,parseInt(x.spamThreshold24h,10)||3),
    codePrefix:String(x.codePrefix||'SARKAR').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12)||'SARKAR',
    maxReferralsPerCustomer:(x.maxReferralsPerCustomer==null||x.maxReferralsPerCustomer==='')?null:Math.max(1,parseInt(x.maxReferralsPerCustomer,10)||1)
  };
  await q('UPDATE referral_settings SET data=$1,updated_at=now() WHERE id=1',[JSON.stringify(data)]);res.json(data);
});
app.delete('/api/admin/referral-settings',auth,async(_,res)=>{
  await q('UPDATE referral_settings SET data=$1,updated_at=now() WHERE id=1',[JSON.stringify(DEFAULT_REFERRAL_SETTINGS)]);res.json(DEFAULT_REFERRAL_SETTINGS);
});
app.get('/api/admin/referrals',auth,async(_,res)=>{
  const [stats,rows,signals]=await Promise.all([
    q(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER(WHERE status='REWARDED')::int AS rewarded,
      COUNT(*) FILTER(WHERE status='PENDING')::int AS pending,
      COUNT(*) FILTER(WHERE status='REJECTED')::int AS rejected,
      COUNT(*) FILTER(WHERE device_match OR multiple_account_signal OR spam_signal OR ip_match)::int AS flagged,
      COALESCE(SUM(reward_amount) FILTER(WHERE status='REWARDED'),0)::numeric AS reward_total
      FROM customer_referrals`),
    q(`SELECT cr.id,cr.referral_code AS "referralCode",cr.status,cr.reward_amount AS "rewardAmount",cr.device_match AS "deviceMatch",cr.multiple_account_signal AS "multipleAccountSignal",cr.spam_signal AS "spamSignal",cr.ip_match AS "ipMatch",cr.fraud_note AS "fraudNote",cr.joined_at AS "joinedAt",cr.rewarded_at AS "rewardedAt",
      r.name AS "referrerName",r.phone AS "referrerPhone",c.name AS "referredName",c.phone AS "referredPhone"
      FROM customer_referrals cr JOIN customers r ON r.id=cr.referrer_customer_id JOIN customers c ON c.id=cr.referred_customer_id
      ORDER BY cr.joined_at DESC LIMIT 500`),
    q(`SELECT id,referral_id AS "referralId",referred_customer_id AS "referredCustomerId",signal_type AS "signalType",severity,details,created_at AS "createdAt" FROM referral_fraud_signals ORDER BY created_at DESC LIMIT 200`)
  ]);
  res.json({stats:stats.rows[0],referrals:rows.rows,signals:signals.rows});
});
app.delete('/api/admin/referrals/:id',auth,async(req,res)=>{
  const r=await q('DELETE FROM customer_referrals WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Referral not found'});res.status(204).end();
});
app.delete('/api/admin/referral-signals/:id',auth,async(req,res)=>{
  const r=await q('DELETE FROM referral_fraud_signals WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Signal not found'});res.status(204).end();
});

app.get('/api/admin/coupons',auth,async(_,res)=>{const r=await q('SELECT id,code,discount_type AS "discountType",discount_value AS "discountValue",min_order AS "minOrder",max_discount AS "maxDiscount",usage_limit AS "usageLimit",used_count AS "usedCount",active,show_on_checkout AS "showOnCheckout",starts_at AS "startsAt",ends_at AS "endsAt" FROM coupons ORDER BY created_at DESC');res.json(r.rows)});
app.post('/api/admin/coupons',auth,async(req,res)=>{const x=req.body||{},code=normalizeCoupon(x.code)||('SAVE'+crypto.randomInt(100000,999999));const type=['PERCENT','FIXED','FREE_DELIVERY'].includes(String(x.discountType||'PERCENT').toUpperCase())?String(x.discountType).toUpperCase():'PERCENT';const value=Math.max(0,Number(x.discountValue)||0),min=Math.max(0,Number(x.minOrder)||0),max=x.maxDiscount==null||x.maxDiscount===''?null:Math.max(0,Number(x.maxDiscount)||0),limit=x.usageLimit==null||x.usageLimit===''?null:Math.max(1,parseInt(x.usageLimit,10));try{const r=await q('INSERT INTO coupons(code,discount_type,discount_value,min_order,max_discount,usage_limit,active,show_on_checkout,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,code,discount_type AS "discountType",discount_value AS "discountValue",min_order AS "minOrder",max_discount AS "maxDiscount",usage_limit AS "usageLimit",used_count AS "usedCount",active,show_on_checkout AS "showOnCheckout",starts_at AS "startsAt",ends_at AS "endsAt"',[code,type,value,min,max,limit,x.active!==false,x.showOnCheckout!==false,x.startsAt||null,x.endsAt||null]);res.status(201).json(r.rows[0])}catch(e){if(e.code==='23505')return res.status(409).json({error:'এই coupon code আগে থেকেই আছে'});throw e}});
app.put('/api/admin/coupons/:id',auth,async(req,res)=>{const x=req.body||{},code=normalizeCoupon(x.code);if(!code)return res.status(400).json({error:'Coupon code required'});const type=['PERCENT','FIXED','FREE_DELIVERY'].includes(String(x.discountType||'PERCENT').toUpperCase())?String(x.discountType).toUpperCase():'PERCENT';const value=Math.max(0,Number(x.discountValue)||0),min=Math.max(0,Number(x.minOrder)||0),max=x.maxDiscount==null||x.maxDiscount===''?null:Math.max(0,Number(x.maxDiscount)||0),limit=x.usageLimit==null||x.usageLimit===''?null:Math.max(1,parseInt(x.usageLimit,10));const r=await q('UPDATE coupons SET code=$1,discount_type=$2,discount_value=$3,min_order=$4,max_discount=$5,usage_limit=$6,active=$7,show_on_checkout=$8,starts_at=$9,ends_at=$10,updated_at=now() WHERE id=$11 RETURNING id,code,discount_type AS "discountType",discount_value AS "discountValue",min_order AS "minOrder",max_discount AS "maxDiscount",usage_limit AS "usageLimit",used_count AS "usedCount",active,show_on_checkout AS "showOnCheckout",starts_at AS "startsAt",ends_at AS "endsAt"',[code,type,value,min,max,limit,x.active!==false,x.showOnCheckout!==false,x.startsAt||null,x.endsAt||null,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Coupon not found'});res.json(r.rows[0])});
app.delete('/api/admin/coupons/:id',auth,async(req,res)=>{await q('DELETE FROM coupons WHERE id=$1',[req.params.id]);res.status(204).end()});
app.get('/api/admin/riders',auth,async(_,res)=>{const r=await q('SELECT id,name,phone,active,online,created_at AS "createdAt",first_name AS "firstName",last_name AS "lastName",gender,dob,email,full_address AS "fullAddress",pin_code AS "pinCode" FROM riders ORDER BY online DESC,created_at ASC');res.json(r.rows)});
app.post('/api/admin/riders',auth,async(req,res)=>{const name=String(req.body.name||'').trim(),phone=cleanPhone(req.body.phone),password=String(req.body.password||'');if(!name||phone.length<10||password.length<6)return res.status(400).json({error:'Name, valid mobile and 6+ character password required'});const hash=await bcrypt.hash(password,12);try{const r=await q('INSERT INTO riders(name,phone,password_hash,active) VALUES($1,$2,$3,true) RETURNING id,name,phone,active,online',[name,phone,hash]);res.status(201).json(r.rows[0])}catch(e){if(e.code==='23505')return res.status(409).json({error:'এই rider mobile আগে থেকেই আছে'});throw e}});
app.patch('/api/admin/riders/:id',auth,async(req,res)=>{const active=req.body.active!==false;const r=await q('UPDATE riders SET active=$1,online=CASE WHEN $1=false THEN false ELSE online END,updated_at=now() WHERE id=$2 RETURNING id,name,phone,active,online',[active,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Rider not found'});res.json(r.rows[0])});
app.patch('/api/admin/riders/:id/profile',auth,async(req,res)=>{const b=req.body||{};const fields=[String(b.firstName||'').trim(),String(b.lastName||'').trim(),String(b.gender||'').trim(),b.dob||null,String(b.email||'').trim(),String(b.fullAddress||'').trim(),String(b.pinCode||'').trim()];const r=await q(`UPDATE riders SET name=$1,first_name=$2,last_name=$3,gender=$4,dob=$5,email=$6,full_address=$7,pin_code=$8,updated_at=now() WHERE id=$9 RETURNING id,name,phone,active,online,first_name AS "firstName",last_name AS "lastName",gender,dob,email,full_address AS "fullAddress",pin_code AS "pinCode"`,[`${fields[0]} ${fields[1]}`.trim(),...fields,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Rider not found'});res.json(r.rows[0])});
app.patch('/api/admin/riders/:id/password',auth,async(req,res)=>{const password=String(req.body?.password||'');if(password.length<6)return res.status(400).json({error:'Password must be at least 6 characters'});const hash=await bcrypt.hash(password,12);const r=await q('UPDATE riders SET password_hash=$1,updated_at=now() WHERE id=$2 RETURNING id,phone',[hash,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Rider not found'});res.json({ok:true,id:r.rows[0].id,phone:r.rows[0].phone})});

app.get('/api/coupons/public',async(_,res)=>{const r=await q("SELECT code,discount_type AS \"discountType\",discount_value AS \"discountValue\",min_order AS \"minOrder\",max_discount AS \"maxDiscount\" FROM coupons WHERE active=true AND show_on_checkout=true AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>=now()) AND (usage_limit IS NULL OR used_count<usage_limit) ORDER BY created_at DESC");res.json(r.rows)});
function normalizeCustomerProfileSettings(data){
  const x={...(data||{})};
  const ps=x.profileSetup&&typeof x.profileSetup==='object'?{...x.profileSetup}:{};
  const profile=Array.isArray(ps.items)?ps.items.map((v,i)=>({
    id:String(v?.id||`profile-${Date.now()}-${i}`),
    icon:String(v?.icon||'•'),
    titleEn:String(v?.titleEn||v?.title||'More'),
    titleBn:String(v?.titleBn||v?.subtitle||''),
    description:String(v?.description||v?.details||''),
    action:String(v?.action||'custom'),
    published:v?.published!==false
  })):[];
  const more=Array.isArray(x.moreOptions)?x.moreOptions.map((v,i)=>({
    id:String(v?.id||`more-${Date.now()}-${i}`),
    icon:String(v?.icon||'•'),
    titleEn:String(v?.titleEn||v?.title||'More'),
    titleBn:String(v?.titleBn||v?.subtitle||''),
    description:String(v?.description||v?.details||''),
    action:String(v?.action||v?.type||'custom'),
    published:v?.published!==false
  })):[];
  const seen=new Set();
  const unique=(list)=>{
    const out=[];
    for(const v of list){
      const action=String(v.action||'custom');
      const title=(v.titleEn+'|'+v.titleBn).trim().toLowerCase();
      const key=action!=='custom'&&action!=='content'?`action:${action}`:`title:${title}`;
      if(seen.has(key))continue;
      seen.add(key);out.push(v);
    }
    return out;
  };
  x.profileSetup={
    ...ps,
    enabled:ps.enabled!==false,
    eyebrow:String(ps.eyebrow||'ACCOUNT CENTER'),
    title:String(ps.title||'Your Profile'),
    subtitle:String(ps.subtitle||'আপনার account, preferences ও information পরিচালনা করুন।'),
    items:unique(profile)
  };
  x.moreOptions=unique(more);
  return x;
}
app.get('/api/settings',async(_,res)=>{const r=await q('SELECT data FROM settings WHERE id=1');res.json(r.rows[0]?.data||{})});
app.put('/api/settings',auth,async(req,res)=>{
  const data=normalizeCustomerProfileSettings(req.body||{});
  await q('UPDATE settings SET data=$1,updated_at=now() WHERE id=1',[JSON.stringify(data)]);
  res.json(data);
});
app.get('/api/products',async(_,res)=>{const r=await q('SELECT id,name,en,category,price,description AS desc,image,video,published FROM products WHERE published=true ORDER BY created_at DESC');res.json(r.rows)});
app.get('/api/admin/products',auth,async(_,res)=>{const r=await q('SELECT id,name,en,category,price,description AS desc,image,video,published FROM products ORDER BY created_at DESC');res.json(r.rows)});
app.post('/api/admin/products',auth,async(req,res)=>{const x=req.body||{};if(!String(x.name||'').trim())return res.status(400).json({error:'Name required'});const r=await q('INSERT INTO products(name,en,category,price,description,image,video,published) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,en,category,price,description AS desc,image,video,published',[String(x.name).trim(),String(x.en||''),String(x.category||''),Number(x.price||0),String(x.desc||''),String(x.image||''),String(x.video||''),x.published!==false]);res.status(201).json(r.rows[0])});
app.put('/api/admin/products/:id',auth,async(req,res)=>{const x=req.body||{};const r=await q('UPDATE products SET name=$1,en=$2,category=$3,price=$4,description=$5,image=$6,video=$7,published=$8,updated_at=now() WHERE id=$9 RETURNING id,name,en,category,price,description AS desc,image,video,published',[String(x.name||'').trim(),String(x.en||''),String(x.category||''),Number(x.price||0),String(x.desc||''),String(x.image||''),String(x.video||''),x.published!==false,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Not found'});res.json(r.rows[0])});
app.delete('/api/admin/products/:id',auth,async(req,res)=>{await q('DELETE FROM products WHERE id=$1',[req.params.id]);res.status(204).end()});
app.post('/api/orders',async(req,res)=>{
  const x=req.body||{},name=String(x.name||'').trim().slice(0,120),phone=cleanPhone(x.phone),address=String(x.address||'').trim().slice(0,500),items=Array.isArray(x.items)?x.items:[],location=x.location||null;
  if(!name||!phone||!address||!items.length)return res.status(400).json({error:'Name, mobile, address and items are required'});
  const ids=items.map(i=>i.productId).filter(Boolean);
  const r=await q('SELECT id,name,price FROM products WHERE id=ANY($1::uuid[]) AND published=true',[ids]);
  const byId=new Map(r.rows.map(p=>[p.id,p])); let normalized=[],subtotal=0;
  for(const item of items){const p=byId.get(item.productId),qty=Math.max(1,Math.min(99,Number(item.qty)||1));if(!p)return res.status(400).json({error:'One or more menu items are unavailable'});const price=Number(p.price);normalized.push({productId:p.id,name:p.name,qty,price});subtotal+=price*qty;}
  const settings=(await q('SELECT data FROM settings WHERE id=1')).rows[0]?.data||{},fee=Math.max(0,Number(settings.deliveryFee)||0);
  const coupon=await calculateCoupon(x.couponCode,subtotal,fee); if(coupon.error)return res.status(400).json({error:coupon.error});
  const discount=coupon.discount,total=Math.max(0,subtotal+fee-discount),id='SK'+crypto.randomBytes(4).toString('hex').toUpperCase(),accessToken=crypto.randomBytes(24).toString('hex');
  let customerId=null; const ct=customerBearer(req); if(ct){try{const cp=jwt.verify(ct,process.env.JWT_SECRET);if(cp.scope==='customer')customerId=cp.sub;}catch{}}
  const paymentMethod=String(x.paymentMethod||'COD').toUpperCase()==='ONLINE'?'ONLINE':'COD';
  const deliverySlot='ASAP';
  const scheduledAt=null;
  const onlineMethod=String(x.onlineMethod||'UPI').toUpperCase();
  if(paymentMethod==='ONLINE' && !['UPI','CARD','NETBANKING'].includes(onlineMethod))return res.status(400).json({error:'Invalid online payment method'});
  const client=await pool.connect(); try{await client.query('BEGIN');
    if(coupon.coupon)await client.query('UPDATE coupons SET used_count=used_count+1,updated_at=now() WHERE id=$1',[coupon.coupon.id]);
    const ins=await client.query('INSERT INTO orders(id,customer_id,customer_name,phone,address,items,subtotal,delivery_fee,discount_amount,coupon_code,total,payment_method,payment_status,access_token_hash,delivery_latitude,delivery_longitude,delivery_slot,scheduled_at,online_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id,customer_id,customer_name AS name,phone,address,items,subtotal,delivery_fee,discount_amount,coupon_code,total,status,payment_method AS "paymentMethod",payment_status AS "paymentStatus",delivery_slot AS "deliverySlot",scheduled_at AS "scheduledAt",online_method AS "onlineMethod",created_at AS "createdAt"',[id,customerId,name,phone,address,JSON.stringify(normalized),subtotal,fee,discount,coupon.code,total,paymentMethod,'PENDING',tokenHash(accessToken),location?.latitude||null,location?.longitude||null,deliverySlot,deliverySlot==='SCHEDULED'?scheduledAt:null,paymentMethod==='ONLINE'?onlineMethod:null]);
    await client.query('COMMIT'); notify('order.created',{id,name,phone,total,paymentMethod,couponCode:coupon.code}); res.status(201).json({...ins.rows[0],accessToken});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});
app.get('/api/orders',async(req,res)=>{const ct=customerBearer(req);let r;if(ct){try{const cp=jwt.verify(ct,process.env.JWT_SECRET);if(cp.scope!=='customer')throw Error();r=await q('SELECT id,customer_name AS name,phone,address,items,subtotal,delivery_fee,discount_amount,coupon_code,total,status,payment_method AS "paymentMethod",payment_status AS "paymentStatus",created_at AS "createdAt",completed_at AS "completedAt" FROM orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100',[cp.sub]);return res.json(r.rows)}catch{}}const phone=cleanPhone(req.query.phone);if(!phone)return res.status(400).json({error:'phone required'});r=await q('SELECT id,customer_name AS name,phone,address,items,subtotal,delivery_fee,discount_amount,coupon_code,total,status,payment_method AS "paymentMethod",payment_status AS "paymentStatus",created_at AS "createdAt",completed_at AS "completedAt" FROM orders WHERE phone=$1 ORDER BY created_at DESC LIMIT 100',[phone]);res.json(r.rows)});
app.get('/api/customer/orders/:id/rating',async(req,res)=>{
  try{
    let order=null,customerId=null;
    const ct=customerBearer(req);
    if(ct){try{const cp=jwt.verify(ct,process.env.JWT_SECRET);if(cp.scope==='customer'){customerId=cp.sub;const r=await q('SELECT id,items FROM orders WHERE id=$1 AND customer_id=$2',[req.params.id,cp.sub]);if(r.rowCount)order=r.rows[0];}}catch{}}
    if(!order && req.query.accessToken){
      const h=tokenHash(req.query.accessToken);const r=await q('SELECT id,items FROM orders WHERE id=$1 AND access_token_hash=$2',[req.params.id,h]);if(r.rowCount)order=r.rows[0];
    }
    if(!order)return res.status(401).json({error:'Order access required'});
    const productId=Array.isArray(order.items)?(order.items[0]?.productId||null):null;
    const own=await q('SELECT rating,review FROM customer_order_ratings WHERE order_id=$1',[req.params.id]);
    const stats=productId
      ? await q('SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE rating=5)::int AS five,COALESCE(AVG(rating),0)::numeric AS avg FROM customer_order_ratings WHERE product_id=$1',[productId])
      : await q('SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE rating=5)::int AS five,COALESCE(AVG(rating),0)::numeric AS avg FROM customer_order_ratings WHERE order_id=$1',[req.params.id]);
    const s=stats.rows[0]||{total:0,five:0,avg:0};
    res.json({rating:own.rows[0]?.rating||0,review:own.rows[0]?.review||'',totalRatings:Number(s.total||0),fiveStarCount:Number(s.five||0),averageRating:Number(s.avg||0)});
  }catch(e){res.status(500).json({error:'Rating load failed'})}
});
app.post('/api/customer/orders/:id/rating',async(req,res)=>{
  try{
    const rating=Math.max(1,Math.min(5,parseInt(req.body.rating,10)||0));
    const review=String(req.body.review||'').trim().slice(0,500);
    if(!rating)return res.status(400).json({error:'Star rating required'});
    let order=null,customerId=null;
    const ct=customerBearer(req);
    if(ct){try{const cp=jwt.verify(ct,process.env.JWT_SECRET);if(cp.scope==='customer'){customerId=cp.sub;const r=await q('SELECT id,items FROM orders WHERE id=$1 AND customer_id=$2',[req.params.id,cp.sub]);if(r.rowCount)order=r.rows[0];}}catch{}}
    if(!order && req.body.accessToken){const h=tokenHash(req.body.accessToken);const r=await q('SELECT id,items FROM orders WHERE id=$1 AND access_token_hash=$2',[req.params.id,h]);if(r.rowCount)order=r.rows[0];}
    if(!order)return res.status(401).json({error:'Order access required'});
    const productId=Array.isArray(order.items)?(order.items[0]?.productId||null):null;
    await q(`INSERT INTO customer_order_ratings(order_id,customer_id,product_id,rating,review)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(order_id) DO UPDATE SET customer_id=EXCLUDED.customer_id,product_id=EXCLUDED.product_id,rating=EXCLUDED.rating,review=EXCLUDED.review,updated_at=now()`,[req.params.id,customerId,productId,rating,review]);
    const stats=productId?await q('SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE rating=5)::int AS five,COALESCE(AVG(rating),0)::numeric AS avg FROM customer_order_ratings WHERE product_id=$1',[productId]):await q('SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE rating=5)::int AS five,COALESCE(AVG(rating),0)::numeric AS avg FROM customer_order_ratings WHERE order_id=$1',[req.params.id]);
    const s=stats.rows[0]||{total:0,five:0,avg:0};res.json({rating,review,totalRatings:Number(s.total||0),fiveStarCount:Number(s.five||0),averageRating:Number(s.avg||0)});
  }catch(e){res.status(500).json({error:'Rating submit failed'})}
});
app.get('/api/admin/orders',auth,async(_,res)=>{const r=await q(`SELECT o.id,o.customer_name AS name,o.phone,o.address,o.items,o.subtotal,o.delivery_fee,o.discount_amount,o.coupon_code,o.total,o.status,o.payment_method AS "paymentMethod",o.payment_status AS "paymentStatus",o.created_at AS "createdAt",o.updated_at AS "updatedAt",o.completed_at AS "completedAt",o.assigned_rider_id AS "assignedRiderId",r.name AS "riderName",r.phone AS "riderPhone" FROM orders o LEFT JOIN riders r ON r.id=o.assigned_rider_id ORDER BY o.created_at DESC LIMIT 1000`);res.json(r.rows)});
app.patch('/api/admin/orders/:id/status',auth,async(req,res)=>{
 const status=String(req.body.status||'').toUpperCase();
 if(!allowedStatuses.has(status))return res.status(400).json({error:'Invalid status'});
 const client=await pool.connect();
 try{await client.query('BEGIN');
   let assigned=null;
   if(status==='READY'){
     const existing=await client.query('SELECT assigned_rider_id FROM orders WHERE id=$1 FOR UPDATE',[req.params.id]);
     if(!existing.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Order not found'});}
     assigned=existing.rows[0].assigned_rider_id;
     if(!assigned){const rr=await client.query("SELECT r.id FROM riders r WHERE r.active=true AND r.online=true AND NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.assigned_rider_id=r.id AND o2.status IN ('READY','OUT_FOR_DELIVERY')) ORDER BY r.online DESC,r.created_at ASC LIMIT 1");assigned=rr.rows[0]?.id||null;}
   }
   const r=await client.query('UPDATE orders SET status=$1,assigned_rider_id=COALESCE($2,assigned_rider_id),updated_at=now(),completed_at=CASE WHEN $1=\'DELIVERED\' THEN COALESCE(completed_at,now()) ELSE completed_at END WHERE id=$3 RETURNING id,status,assigned_rider_id AS "assignedRiderId",updated_at AS "updatedAt",completed_at AS "completedAt"',[status,assigned,req.params.id]);
   if(!r.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Order not found'});}
   if(status==='DELIVERED'){const od=await client.query('SELECT customer_id,total FROM orders WHERE id=$1',[req.params.id]);if(od.rowCount)await maybeRewardReferral(client,od.rows[0].customer_id,req.params.id,od.rows[0].total);}
   await client.query('COMMIT');
   res.json(r.rows[0]);
 }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(500).json({error:e.message})}finally{client.release()}
});
const riderOtpStore = new Map();
function riderOtpCleanup(){const now=Date.now();for(const [phone,v] of riderOtpStore){if(v.expiresAt<now)riderOtpStore.delete(phone)}}
setInterval(riderOtpCleanup,60000).unref?.();
app.post('/api/rider/otp/request',async(req,res)=>{
  const phone=cleanPhone(req.body?.phone);
  if(phone.length<10)return res.status(400).json({error:'Valid mobile number required'});
  const code=String(Math.floor(100000+Math.random()*900000));
  riderOtpStore.set(phone,{code,expiresAt:Date.now()+5*60*1000,attempts:0});
  res.json({ok:true,testing:true,otp:code,expiresIn:300,message:'Testing OTP generated'});
});
app.post('/api/rider/otp/verify',async(req,res)=>{
  const phone=cleanPhone(req.body?.phone),code=String(req.body?.code||'').trim(),v=riderOtpStore.get(phone);
  if(!v||v.expiresAt<Date.now())return res.status(400).json({error:'OTP expired. Request a new OTP.'});
  v.attempts++; if(v.attempts>5){riderOtpStore.delete(phone);return res.status(429).json({error:'Too many OTP attempts'});}
  if(v.code!==code)return res.status(400).json({error:'Invalid OTP'});
  riderOtpStore.delete(phone);
  const verificationToken=jwt.sign({phone,scope:'rider_otp'},process.env.JWT_SECRET,{expiresIn:'15m'});
  res.json({ok:true,verificationToken});
});
app.post('/api/auth/rider/register',async(req,res)=>{
  const b=req.body||{},phone=cleanPhone(b.phone),firstName=String(b.firstName||'').trim(),lastName=String(b.lastName||'').trim(),password=String(b.password||'');
  if(phone.length<10||!firstName||!lastName||password.length<6)return res.status(400).json({error:'First name, last name, valid mobile and 6+ character password required'});
  try{const v=jwt.verify(String(b.verificationToken||''),process.env.JWT_SECRET);if(v.scope!=='rider_otp'||cleanPhone(v.phone)!==phone)throw Error('bad')}catch{return res.status(400).json({error:'Mobile OTP verification required'})}
  try{
    const hash=await bcrypt.hash(password,12);
    const r=await q(`INSERT INTO riders(name,phone,password_hash,active,first_name,last_name,gender,dob,email,full_address,pin_code) VALUES($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10) RETURNING id,name,phone,active,online,first_name AS "firstName",last_name AS "lastName",gender,dob,email,full_address AS "fullAddress",pin_code AS "pinCode"`,[
      `${firstName} ${lastName}`.trim(),phone,hash,firstName,lastName,String(b.gender||'').trim(),b.dob||null,String(b.email||'').trim(),String(b.fullAddress||'').trim(),String(b.pinCode||'').trim()]);
    res.status(201).json(r.rows[0]);
  }catch(e){if(e.code==='23505')return res.status(409).json({error:'এই rider mobile আগে থেকেই আছে'});throw e}
});
app.post('/api/auth/rider/login',async(req,res)=>{const phone=cleanPhone(req.body.phone),password=String(req.body.password||'');const r=await q('SELECT * FROM riders WHERE phone=$1 AND active=true',[phone]);if(!r.rowCount)return res.status(401).json({error:'Invalid rider login'});const x=r.rows[0];if(!(await bcrypt.compare(password,x.password_hash)))return res.status(401).json({error:'Invalid rider login'});await q('UPDATE riders SET online=true,updated_at=now() WHERE id=$1',[x.id]);const token=jwt.sign({sub:x.id,scope:'rider',phone:x.phone},process.env.JWT_SECRET,{expiresIn:'30d'});res.json({token,rider:{id:x.id,name:x.name,phone:x.phone,firstName:x.first_name||'',lastName:x.last_name||'',gender:x.gender||'',dob:x.dob,email:x.email||'',fullAddress:x.full_address||'',pinCode:x.pin_code||''}})});
app.post('/api/auth/rider/logout',riderAuth,async(req,res)=>{await q('UPDATE riders SET online=false,updated_at=now() WHERE id=$1',[req.rider.sub]);res.json({ok:true})});
app.get('/api/rider/me',riderAuth,async(req,res)=>{const r=await q('SELECT id,name,phone,active,online,first_name AS "firstName",last_name AS "lastName",gender,dob,email,full_address AS "fullAddress",pin_code AS "pinCode" FROM riders WHERE id=$1',[req.rider.sub]);if(!r.rowCount)return res.status(404).json({error:'Rider not found'});res.json(r.rows[0])});
app.patch('/api/rider/availability',riderAuth,async(req,res)=>{const online=Boolean(req.body.online);const r=await q('UPDATE riders SET online=$1,updated_at=now() WHERE id=$2 AND active=true RETURNING id,name,phone,online',[online,req.rider.sub]);if(!r.rowCount)return res.status(404).json({error:'Rider not found'});res.json(r.rows[0])});
app.get('/api/rider/orders',riderAuth,async(req,res)=>{const client=await pool.connect();try{await client.query('BEGIN');const rider=await client.query('SELECT id FROM riders WHERE id=$1 AND active=true AND online=true FOR UPDATE',[req.rider.sub]);if(rider.rowCount){const pending=await client.query(`SELECT id FROM orders WHERE assigned_rider_id IS NULL AND status='READY' ORDER BY created_at ASC LIMIT 5 FOR UPDATE SKIP LOCKED`);for(const row of pending.rows)await client.query('UPDATE orders SET assigned_rider_id=$1,updated_at=now() WHERE id=$2 AND assigned_rider_id IS NULL',[req.rider.sub,row.id]);}await client.query('COMMIT');const r=await client.query(`SELECT o.id,o.customer_name AS name,o.phone,o.address,o.items,o.subtotal,o.delivery_fee,o.total,o.status,o.payment_method AS "paymentMethod",o.payment_status AS "paymentStatus",o.delivery_latitude AS "customerLat",o.delivery_longitude AS "customerLon",o.created_at AS "createdAt",o.updated_at AS "updatedAt" FROM orders o WHERE o.assigned_rider_id=$1 AND o.status IN ('READY','OUT_FOR_DELIVERY') ORDER BY CASE WHEN o.status='OUT_FOR_DELIVERY' THEN 0 ELSE 1 END,o.created_at ASC`,[req.rider.sub]);res.json(r.rows)}catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(500).json({error:e.message})}finally{client.release()}});
app.patch('/api/rider/orders/:id/status',riderAuth,async(req,res)=>{const status=String(req.body.status||'').toUpperCase();if(!['OUT_FOR_DELIVERY','DELIVERED'].includes(status))return res.status(400).json({error:'Invalid rider status'});const r=await q('UPDATE orders SET status=$1,updated_at=now(),completed_at=CASE WHEN $1=\'DELIVERED\' THEN COALESCE(completed_at,now()) ELSE completed_at END WHERE id=$2 AND assigned_rider_id=$3 AND status IN (\'READY\',\'OUT_FOR_DELIVERY\') RETURNING id,status',[status,req.params.id,req.rider.sub]);if(!r.rowCount)return res.status(404).json({error:'Assigned order not found'});if(status==='DELIVERED'){const od=await q('SELECT customer_id,total FROM orders WHERE id=$1',[req.params.id]);if(od.rowCount){const client=await pool.connect();try{await client.query('BEGIN');await maybeRewardReferral(client,od.rows[0].customer_id,req.params.id,od.rows[0].total);await client.query('COMMIT')}catch(e){await client.query('ROLLBACK').catch(()=>{});console.warn('Referral reward failed',e.message)}finally{client.release()}}}res.json(r.rows[0])});
app.post('/api/rider/location',riderAuth,async(req,res)=>{const orderId=String(req.body.orderId||'');const lat=Number(req.body.latitude),lng=Number(req.body.longitude),accuracy=req.body.accuracy==null?null:Number(req.body.accuracy);if(!orderId||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)return res.status(400).json({error:'Invalid location'});const r=await q('SELECT id,status FROM orders WHERE id=$1 AND assigned_rider_id=$2 AND status IN (\'OUT_FOR_DELIVERY\',\'READY\')',[orderId,req.rider.sub]);if(!r.rowCount)return res.status(404).json({error:'Assigned order not found'});await q('INSERT INTO tracking_points(order_id,latitude,longitude,accuracy) VALUES($1,$2,$3,$4)',[orderId,lat,lng,Number.isFinite(accuracy)?accuracy:null]);await q("UPDATE orders SET status='OUT_FOR_DELIVERY',updated_at=now() WHERE id=$1 AND status='READY'",[orderId]);res.json({ok:true,orderId})});
app.get('/api/admin/orders/:id/tracking',auth,async(req,res)=>{const o=await q('SELECT id,status,delivery_latitude AS "customerLat",delivery_longitude AS "customerLon",assigned_rider_id AS "assignedRiderId" FROM orders WHERE id=$1',[req.params.id]);if(!o.rowCount)return res.status(404).json({error:'Order not found'});const t=await q('SELECT latitude,longitude,accuracy,recorded_at AS "recordedAt" FROM tracking_points WHERE order_id=$1 ORDER BY recorded_at DESC LIMIT 1',[req.params.id]);const x=t.rows[0]||null;let distanceKm=null,etaMin=null;if(x&&o.rows[0].customerLat!=null&&o.rows[0].customerLon!=null){try{const rr=await fetch(`https://router.project-osrm.org/route/v1/driving/${x.longitude},${x.latitude};${o.rows[0].customerLon},${o.rows[0].customerLat}?overview=false`);const route=await rr.json();if(route.routes?.[0]){distanceKm=+(route.routes[0].distance/1000).toFixed(1);etaMin=Math.round(route.routes[0].duration/60)}}catch{}}res.json({order:o.rows[0],location:x,distanceKm,etaMin})});
app.get('/api/customer/orders/:id', async (req,res)=>{
  try{
    const token=customerBearer(req); if(!token) return res.status(401).json({error:'Customer login required'});
    const cp=jwt.verify(token,process.env.JWT_SECRET); if(cp.scope!=='customer') return res.status(401).json({error:'Customer login required'});
    const r=await q(`SELECT id,customer_name AS name,phone,address,items,subtotal,delivery_fee,discount_amount,coupon_code,total,status,payment_method AS "paymentMethod",payment_status AS "paymentStatus",delivery_slot AS "deliverySlot",scheduled_at AS "scheduledAt",online_method AS "onlineMethod",assigned_rider_id AS "assignedRiderId",created_at AS "createdAt",updated_at AS "updatedAt",completed_at AS "completedAt" FROM orders WHERE id=$1 AND customer_id=$2`,[req.params.id,cp.sub]);
    if(!r.rowCount) return res.status(404).json({error:'Order not found'});
    res.json(r.rows[0]);
  }catch(e){res.status(401).json({error:'Invalid customer session'})}
});

app.get('/api/customer/orders/:id/tracking', async (req,res)=>{
  try{
    const token=customerBearer(req); if(!token) return res.status(401).json({error:'Customer login required'});
    const cp=jwt.verify(token,process.env.JWT_SECRET); if(cp.scope!=='customer') return res.status(401).json({error:'Customer login required'});
    const o=await q('SELECT id,status,delivery_latitude AS "customerLat",delivery_longitude AS "customerLon",assigned_rider_id AS "assignedRiderId" FROM orders WHERE id=$1 AND customer_id=$2',[req.params.id,cp.sub]);
    if(!o.rowCount)return res.status(404).json({error:'Order not found'});
    const t=await q('SELECT latitude,longitude,accuracy,recorded_at AS "recordedAt" FROM tracking_points WHERE order_id=$1 ORDER BY recorded_at DESC LIMIT 1',[req.params.id]);
    const location=t.rows[0]||null; let distanceKm=null,etaMin=null;
    if(location&&o.rows[0].customerLat!=null&&o.rows[0].customerLon!=null){try{const rr=await fetch(`https://router.project-osrm.org/route/v1/driving/${location.longitude},${location.latitude};${o.rows[0].customerLon},${o.rows[0].customerLat}?overview=false`);const route=await rr.json();if(route.routes?.[0]){distanceKm=+(route.routes[0].distance/1000).toFixed(1);etaMin=Math.round(route.routes[0].duration/60)}}catch{}}
    res.json({order:o.rows[0],location,distanceKm,etaMin,delivered:o.rows[0].status==='DELIVERED'});
  }catch(e){res.status(401).json({error:'Invalid customer session'})}
});

app.get('/api/orders/:id/tracking', async (req, res) => {
  try {
    const token = String(req.query.accessToken || '');
    if (!token) return res.status(401).json({ error: 'Access token required' });

    const o = await q(
      `SELECT id,status,delivery_latitude,delivery_longitude
       FROM orders
       WHERE id=$1 AND access_token_hash=$2`,
      [req.params.id, tokenHash(token)]
    );

    if (!o.rowCount)
      return res.status(404).json({ error: 'Order not found' });

    const order = o.rows[0];

    if (order.status === 'DELIVERED') {
      return res.json({
        delivered: true,
        location: null,
        distanceKm: 0,
        etaMin: 0
      });
    }

    const t = await q(
      `SELECT latitude,longitude
       FROM tracking_points
       WHERE order_id=$1
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [req.params.id]
    );

    const location = t.rows[0] || null;

    let distanceKm = null;
    let etaMin = null;

    if (location && order.delivery_latitude && order.delivery_longitude) {
      try {
        const rr = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${location.longitude},${location.latitude};${order.delivery_longitude},${order.delivery_latitude}?overview=false`
        );
        const route = await rr.json();

        if (route.routes?.length) {
          distanceKm = +(route.routes[0].distance / 1000).toFixed(1);
          etaMin = Math.round(route.routes[0].duration / 60);
        }
      } catch {}
    }

    res.json({
      delivered: false,
      location,
      distanceKm,
      etaMin
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/payments/razorpay/order',async(req,res)=>{
  if(!razorConfigured())return res.status(503).json({error:'Online payment is not configured on this server'});
  const orderId=String(req.body.orderId||''),accessToken=String(req.body.accessToken||'');
  const r=await q('SELECT id,total,payment_method AS \"paymentMethod\",payment_status AS \"paymentStatus\",customer_name AS name,phone FROM orders WHERE id=$1 AND access_token_hash=$2',[orderId,tokenHash(accessToken)]);
  if(!r.rowCount)return res.status(404).json({error:'Order not found'});
  const o=r.rows[0]; if(o.paymentMethod!=='ONLINE')return res.status(400).json({error:'This order is not an online-payment order'});
  const amount=Math.round(Number(o.total)*100);
  const auth=Buffer.from(process.env.RAZORPAY_KEY_ID+':'+process.env.RAZORPAY_KEY_SECRET).toString('base64');
  const rr=await fetch('https://api.razorpay.com/v1/orders',{method:'POST',headers:{Authorization:'Basic '+auth,'Content-Type':'application/json'},body:JSON.stringify({amount,currency:'INR',receipt:o.id,notes:{sarkar_order_id:o.id}})});
  const data=await rr.json(); if(!rr.ok)return res.status(502).json({error:data?.error?.description||'Payment provider error'});
  await q('INSERT INTO payments(order_id,provider,provider_order_id,amount,currency,status) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider_order_id) DO UPDATE SET amount=EXCLUDED.amount,status=EXCLUDED.status',[o.id,'razorpay',data.id,amount,'INR','CREATED']);
  res.json({keyId:process.env.RAZORPAY_KEY_ID,orderId:o.id,razorpayOrderId:data.id,amount,currency:'INR',name:o.name,phone:o.phone});
});
app.post('/api/payments/razorpay/verify',async(req,res)=>{
  const orderId=String(req.body.orderId||''),accessToken=String(req.body.accessToken||''),paymentId=String(req.body.razorpay_payment_id||''),razorpayOrderId=String(req.body.razorpay_order_id||''),signature=String(req.body.razorpay_signature||'');
  const r=await q('SELECT id FROM orders WHERE id=$1 AND access_token_hash=$2',[orderId,tokenHash(accessToken)]); if(!r.rowCount)return res.status(404).json({error:'Order not found'});
  const p=await q('SELECT * FROM payments WHERE order_id=$1 AND provider=\'razorpay\' AND provider_order_id=$2',[orderId,razorpayOrderId]); if(!p.rowCount)return res.status(400).json({error:'Payment order mismatch'});
  const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET||'').update(razorpayOrderId+'|'+paymentId).digest('hex');
  if(!timingSafeEqualHex(expected,signature))return res.status(400).json({error:'Invalid payment signature'});
  await q('UPDATE payments SET provider_payment_id=$1,signature=$2,status=$3,updated_at=now() WHERE id=$4',[paymentId,signature,'CAPTURED',p.rows[0].id]);
  await q('UPDATE orders SET payment_status=\'PAID\',updated_at=now() WHERE id=$1',[orderId]);
  notify('payment.captured',{orderId,paymentId,provider:'razorpay'});
  res.json({ok:true,paymentStatus:'PAID'});
});
app.post('/api/payments/razorpay/webhook',async(req,res)=>{
  const secret=process.env.RAZORPAY_WEBHOOK_SECRET;
  if(!secret)return res.status(503).json({error:'Webhook secret is not configured'});
  const signature=String(req.headers['x-razorpay-signature']||'');
  const raw=req.rawBody||Buffer.from('');
  const expected=crypto.createHmac('sha256',secret).update(raw).digest('hex');
  if(!timingSafeEqualHex(expected,signature))return res.status(401).json({error:'Invalid webhook signature'});
  const event=String(req.body?.event||'');
  const p=req.body?.payload?.payment?.entity||{};
  const providerPaymentId=String(p.id||'');
  const providerOrderId=String(p.order_id||'');
  if(providerOrderId){
    let status=null;
    if(event==='payment.captured'||event==='order.paid')status='PAID';
    else if(event==='payment.failed')status='FAILED';
    else if(event==='refund.created')status='REFUNDED';
    if(status){
      await q('UPDATE payments SET provider_payment_id=COALESCE($1,provider_payment_id),status=$2,signature=$3,updated_at=now() WHERE provider_order_id=$4',[providerPaymentId,status,signature,providerOrderId]);
      await q('UPDATE orders SET payment_status=$1,updated_at=now() WHERE id=(SELECT order_id FROM payments WHERE provider_order_id=$2)',[status,providerOrderId]);
    }
  }
  res.json({ok:true});
});
app.post('/api/notifications/order-status',auth,async(req,res)=>{const id=String(req.body.orderId||''),status=String(req.body.status||'').toUpperCase();if(!id||!allowedStatuses.has(status))return res.status(400).json({error:'orderId and valid status required'});const r=await q('SELECT id,customer_name AS name,phone,total FROM orders WHERE id=$1',[id]);if(!r.rowCount)return res.status(404).json({error:'Order not found'});await notify('order.status',{...r.rows[0],status});res.json({ok:true})});
app.get('/api/admin/daily',auth,async(_,res)=>{const r=await q(`SELECT DATE(completed_at) AS day,COUNT(*)::int AS orders,COUNT(DISTINCT phone)::int AS customers,COALESCE(SUM(total),0)::numeric AS total FROM orders WHERE status='DELIVERED' AND completed_at IS NOT NULL GROUP BY DATE(completed_at) ORDER BY day DESC LIMIT 366`);res.json(r.rows)});
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));;
app.use((req,res)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'Not found'});res.status(404).send('Not found')});
const port=Number(process.env.PORT||3000);

async function startServer(){
  try{
    await initDatabase();
    app.listen(port,'0.0.0.0',()=>console.log(`MI EXPRESS BIRYANI server listening on 0.0.0.0:${port}`));
  }catch(error){
    console.error('Database initialization failed:',error);
    process.exit(1);
  }
}
startServer();
