const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT || 10000);
const BASE = process.env.PUBLIC_BASE_URL || '';
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_ENV';
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname,'data','mi-express-biryani.db');
fs.mkdirSync(path.dirname(DB_PATH),{recursive:true});
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'1mb'}));
// CORS: same-origin Render deployment works without it; the optional wildcard/origin
// setting also lets the customer HTML be opened locally for testing without the
// browser showing a generic "Failed to fetch" before the request reaches Express.
app.use((req,res,next)=>{
  const configured=String(process.env.CORS_ORIGIN||'').trim();
  const origin=String(req.headers.origin||'');
  if(configured==='*') res.setHeader('Access-Control-Allow-Origin','*');
  else if(configured && origin && origin===configured) res.setHeader('Access-Control-Allow-Origin',origin);
  else if(!configured && (origin==='null' || origin.startsWith('file://'))) res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-Admin-Key');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});
const apiLimiter=rateLimit({windowMs:15*60*1000,max:500,standardHeaders:true,legacyHeaders:false});
const authLimiter=rateLimit({windowMs:10*60*1000,max:30,message:{error:'Too many authentication attempts. Please try again later.'}});
app.use('/api',apiLimiter);

const schema=`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY,name TEXT NOT NULL,en TEXT,category TEXT,price REAL NOT NULL,desc TEXT,image TEXT,video TEXT,published INTEGER DEFAULT 1,sort_order INTEGER DEFAULT 0,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT UNIQUE NOT NULL,email TEXT, password_hash TEXT, gender TEXT,date_of_birth TEXT, referral_code TEXT UNIQUE, promotional_balance REAL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS otp_requests (id TEXT PRIMARY KEY,phone TEXT NOT NULL,mode TEXT NOT NULL,otp_hash TEXT NOT NULL,expires_at TEXT NOT NULL,attempts INTEGER DEFAULT 0,verified INTEGER DEFAULT 0,created_at TEXT NOT NULL,device_id TEXT);
CREATE TABLE IF NOT EXISTS addresses (id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,label TEXT,recipient_name TEXT,phone TEXT,address TEXT NOT NULL,latitude REAL,longitude REAL,is_default INTEGER DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS coupons (id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,description TEXT,discount_type TEXT NOT NULL,discount_value REAL NOT NULL,min_order REAL DEFAULT 0,max_discount REAL,starts_at TEXT,expires_at TEXT,usage_limit INTEGER,used_count INTEGER DEFAULT 0,published INTEGER DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY,customer_id TEXT,name TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL,latitude REAL,longitude REAL,items_json TEXT NOT NULL,subtotal REAL NOT NULL,delivery_fee REAL NOT NULL,discount REAL DEFAULT 0,total REAL NOT NULL,status TEXT NOT NULL,payment_method TEXT NOT NULL,online_method TEXT,payment_status TEXT DEFAULT 'PENDING',razorpay_order_id TEXT,razorpay_payment_id TEXT,assigned_rider_id TEXT,access_token TEXT UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS order_events (id INTEGER PRIMARY KEY AUTOINCREMENT,order_id TEXT NOT NULL,status TEXT,lat REAL,lon REAL,note TEXT,created_at TEXT NOT NULL,FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS ratings (id TEXT PRIMARY KEY,order_id TEXT UNIQUE NOT NULL,customer_id TEXT,rating INTEGER NOT NULL,review TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS riders (id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,active INTEGER DEFAULT 1,latitude REAL,longitude REAL,last_seen TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS referral_events (id TEXT PRIMARY KEY,referrer_customer_id TEXT NOT NULL,referred_customer_id TEXT NOT NULL,referred_name TEXT,reward_amount REAL DEFAULT 50,status TEXT DEFAULT 'pending',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(referrer_customer_id,referred_customer_id),FOREIGN KEY(referrer_customer_id) REFERENCES customers(id) ON DELETE CASCADE,FOREIGN KEY(referred_customer_id) REFERENCES customers(id) ON DELETE CASCADE);
`;
db.exec(schema);

const now=()=>new Date().toISOString();
const id=(prefix='id')=>prefix+'_'+crypto.randomBytes(8).toString('hex');
const normalizePhone=v=>String(v||'').replace(/\D/g,'').slice(-10);
const escNum=v=>Number.isFinite(Number(v))?Number(v):0;
function parseJson(v,fallback){try{return JSON.parse(v)}catch{return fallback}}
function getSetting(k,fallback){const r=db.prepare('SELECT value FROM settings WHERE key=?').get(k);return r?parseJson(r.value,fallback):fallback}
function setSetting(k,v){db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v));}

const defaultSettings={brandBn:'MI EXPRESS BIRYANI',brandEn:'MI EXPRESS BIRYANI',address:'গোসাইপুর, হরিরামপুর রোড, মুর্শিদাবাদ, পশ্চিমবঙ্গ, 742302',addressEn:'Gosaipur, Harirampur Road, Murshidabad, West Bengal - 742302',open:true,deliveryFee:30,couponShowOnCheckout:true,referralReward:50,openingTime:'10:00 AM',closingTime:'9:00 PM',deliveryRadiusKm:10};
const defaultProducts=[
{id:'p1',name:'চিকেন দম বিরিয়ানি (কলকাতা স্পেশাল)',en:'Kolkata Chicken Dum Biryani',category:'বিরিয়ানি',price:160,desc:'সুগন্ধি বাসমতী চাল, নরম চিকেন পিস, সেদ্ধ ডিম ও সোনালী আলু দিয়ে খাঁটি দম বিরিয়ানি।',image:'',video:'',published:true},
{id:'p2',name:'মাটন কাচ্চি দম বিরিয়ানি',en:'Royal Mutton Dum Biryani',category:'বিরিয়ানি',price:240,desc:'রসালো খাসির মাংসের সাথে জাফরানি চাল ও বিশেষ শাহী মসলার মেলবন্ধন।',image:'',video:'',published:true},
{id:'p3',name:'স্পেশাল শাহী ফিরনি',en:'Sweet Shahi Firni',category:'মিষ্টি',price:50,desc:'দুধ, বাসমতী চাল, পেস্তা ও কেশরে তৈরি খাঁটি মিষ্টি ফিরনি।',image:'',video:'',published:true}
];
if(!db.prepare('SELECT 1 FROM settings WHERE key=?').get('core')) setSetting('core',defaultSettings);
if(db.prepare('SELECT COUNT(*) c FROM products').get().c===0){const st=db.prepare('INSERT INTO products(id,name,en,category,price,desc,image,video,published,sort_order,updated_at) VALUES(@id,@name,@en,@category,@price,@desc,@image,@video,@published,@sort_order,@updated_at)');const tx=db.transaction(()=>defaultProducts.forEach((p,i)=>st.run({...p,published:p.published?1:0,sort_order:i,updated_at:now()})));tx();}

function signCustomer(c){const tokenId=id('sess');const exp=new Date(Date.now()+30*24*3600e3).toISOString();db.prepare('INSERT INTO sessions(token_id,customer_id,created_at,expires_at) VALUES(?,?,?,?)').run(tokenId,c.id,now(),exp);return jwt.sign({sub:c.id,sid:tokenId,role:'customer'},JWT_SECRET,{expiresIn:'30d'});}
function signRider(r){return jwt.sign({sub:r.id,role:'rider'},JWT_SECRET,{expiresIn:'30d'});}
function customerFromReq(req){const h=String(req.headers.authorization||'');if(!h.startsWith('Bearer '))return null;try{const p=jwt.verify(h.slice(7),JWT_SECRET);if(p.role!=='customer')return null;const s=db.prepare('SELECT * FROM sessions WHERE token_id=? AND customer_id=?').get(p.sid,p.sub);if(!s||new Date(s.expires_at)<new Date())return null;return db.prepare('SELECT * FROM customers WHERE id=?').get(p.sub)}catch{return null}}
function riderFromReq(req){const h=String(req.headers.authorization||'');if(!h.startsWith('Bearer '))return null;try{const p=jwt.verify(h.slice(7),JWT_SECRET);if(p.role!=='rider')return null;return db.prepare('SELECT * FROM riders WHERE id=? AND active=1').get(p.sub)}catch{return null}}
function requireCustomer(req,res,next){const c=customerFromReq(req);if(!c)return res.status(401).json({error:'Authentication required'});req.customer=c;next();}
function requireRider(req,res,next){const r=riderFromReq(req);if(!r)return res.status(401).json({error:'Rider authentication required'});req.rider=r;next();}
function adminOk(req){const key=String(req.headers['x-admin-key']||req.query.adminKey||'');return !!process.env.ADMIN_PASSWORD && key===process.env.ADMIN_PASSWORD;}
function requireAdmin(req,res,next){if(!adminOk(req))return res.status(401).json({error:'Admin authentication required'});next();}
function productList(){return db.prepare('SELECT id,name,en,category,price,desc,image,video,published FROM products WHERE published=1 ORDER BY sort_order,id').all().map(p=>({...p,published:!!p.published}));}
function allProductList(){return db.prepare('SELECT id,name,en,category,price,desc,image,video,published,sort_order,updated_at FROM products ORDER BY sort_order,id').all().map(p=>({...p,published:!!p.published}));}
function publicCoupons(){const t=now();return db.prepare(`SELECT code,description,discount_type discountType,discount_value discountValue,min_order minOrder,max_discount maxDiscount,starts_at startsAt,expires_at expiresAt FROM coupons WHERE published=1 AND (starts_at IS NULL OR starts_at<=?) AND (expires_at IS NULL OR expires_at>=?) AND (usage_limit IS NULL OR used_count<usage_limit) ORDER BY created_at DESC`).all(t,t);}
function couponValidate(code,subtotal,fee){const normalized=String(code||'').trim().toUpperCase();if(!normalized||!/^[A-Z0-9_-]{2,40}$/.test(normalized))return {valid:false,error:'INVALID_COUPON'};const sub=Number(subtotal),delivery=Number(fee);if(!Number.isFinite(sub)||sub<0||!Number.isFinite(delivery)||delivery<0)return {valid:false,error:'INVALID_ORDER_TOTAL'};const c=db.prepare('SELECT * FROM coupons WHERE code=? AND published=1').get(normalized);if(!c)return {valid:false,error:'INVALID_COUPON'};const t=Date.now();if(c.starts_at&&new Date(c.starts_at).getTime()>t)return {valid:false,error:'COUPON_NOT_STARTED'};if(c.expires_at&&new Date(c.expires_at).getTime()<t)return {valid:false,error:'COUPON_EXPIRED'};if(c.usage_limit!=null&&c.used_count>=c.usage_limit)return {valid:false,error:'COUPON_LIMIT_REACHED'};if(sub<Number(c.min_order||0))return {valid:false,error:`MIN_ORDER_${c.min_order}`};let d=0;const type=String(c.discount_type).toUpperCase();if(type==='PERCENT')d=sub*Number(c.discount_value)/100;else if(type==='FREE_DELIVERY')d=delivery;else d=Number(c.discount_value);if(!Number.isFinite(d)||d<0)return {valid:false,error:'INVALID_COUPON'};if(c.max_discount!=null)d=Math.min(d,Number(c.max_discount));d=Math.max(0,Math.min(d,sub+delivery));return {valid:true,discount:Math.round(d*100)/100,coupon:c};}

async function sendOtp(phone,otp){
  const provider=String(process.env.OTP_PROVIDER||'2factor').toLowerCase();
  if(provider==='2factor'){
    if(!process.env.TWOFACTOR_API_KEY) throw new Error('2Factor OTP is not configured. Add TWOFACTOR_API_KEY.');

    // Primary: current 2Factor JSON OTP API.
    const payload={to:'+91'+phone,template_name:process.env.TWOFACTOR_TEMPLATE_NAME||'MIEEXPRESSOTP',var1:String(otp)};
    const primaryUrl=process.env.TWOFACTOR_OTP_URL||'https://2factor.in/API/V1/OTP/SEND';
    const r=await fetch(primaryUrl,{method:'POST',headers:{'X-API-Key':process.env.TWOFACTOR_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const raw=await r.text();
    let data={};
    try{data=raw?JSON.parse(raw):{};}catch{data={raw:raw.slice(0,1000)};}
    console.log('[2FACTOR] primary HTTP',r.status,'response',JSON.stringify(data));
    if(r.ok && (!data.status || ['sent','success','ok'].includes(String(data.status).toLowerCase()))) return data;

    // Compatibility fallback: 2Factor's documented/manual OTP endpoint.
    // The API key is used only in the request URL and is never logged.
    if(r.status===404 || r.status===405){
      const key=encodeURIComponent(process.env.TWOFACTOR_API_KEY);
      const mobile=encodeURIComponent('+91'+phone);
      const customOtp=encodeURIComponent(String(otp));
      const template=String(process.env.TWOFACTOR_TEMPLATE_NAME||'').trim();
      const legacyUrl=template
        ? `https://2factor.in/API/V1/${key}/SMS/${mobile}/${customOtp}/${encodeURIComponent(template)}`
        : `https://2factor.in/API/V1/${key}/SMS/${mobile}/${customOtp}`;
      const lr=await fetch(legacyUrl,{method:'GET',headers:{'Accept':'application/json'}});
      const lraw=await lr.text();
      let ld={};
      try{ld=lraw?JSON.parse(lraw):{};}catch{ld={raw:lraw.slice(0,1000)};}
      console.log('[2FACTOR] legacy HTTP',lr.status,'response',JSON.stringify(ld));
      const status=String(ld.Status||ld.status||'').toLowerCase();
      if(lr.ok && ['success','sent','ok'].includes(status)) return ld;
      throw new Error(ld.Details||ld.message||ld.error||`2Factor OTP request failed (HTTP ${lr.status})`);
    }

    throw new Error(data.message||data.error||`2Factor OTP request failed (HTTP ${r.status})`);
  }
  if(provider==='msg91'){
    if(process.env.MSG91_AUTHKEY && process.env.MSG91_TEMPLATE_ID){
      const r=await fetch('https://control.msg91.com/api/v5/flow',{method:'POST',headers:{accept:'application/json','content-type':'application/json',authkey:process.env.MSG91_AUTHKEY},body:JSON.stringify({template_id:process.env.MSG91_TEMPLATE_ID,short_url:'0',recipients:[{mobiles:'91'+phone,OTP:String(otp)}]})});
      if(!r.ok)throw new Error('MSG91 OTP request failed');
      return await r.json().catch(()=>({}));
    }
    throw new Error('MSG91 OTP is not configured');
  }
  if(process.env.ALLOW_DEV_OTP==='true'){console.log(`[DEV OTP] +91${phone}: ${otp}`);return {status:'dev'};}
  throw new Error('OTP service is not configured. Set OTP_PROVIDER=2factor and TWOFACTOR_API_KEY.');
}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'MI EXPRESS BIRYANI',time:now()}));
app.get('/api/settings',(req,res)=>res.json({...defaultSettings,...getSetting('core',defaultSettings)}));
app.get('/api/products',(req,res)=>res.json(productList()));
app.get('/api/coupons/public',(req,res)=>res.json(publicCoupons()));
app.post('/api/coupons/validate',(req,res)=>{const r=couponValidate(req.body.code,req.body.subtotal,req.body.deliveryFee);if(!r.valid)return res.status(400).json(r);res.json(r)});

app.post('/api/customer/auth/send-otp',authLimiter,async(req,res)=>{
  const phone=normalizePhone(req.body.phone);
  let mode=req.body.mode==='signup'?'signup':(req.body.mode==='auto'?'auto':'login');
  if(phone.length!==10)return res.status(400).json({error:'Enter a valid 10-digit phone number'});
  const exists=!!db.prepare('SELECT id FROM customers WHERE phone=?').get(phone);
  if(mode==='auto') mode=exists?'login':'signup';
  if(mode==='login'&&!exists)return res.status(404).json({error:'no account found'});
  if(mode==='signup'&&exists)return res.status(409).json({error:'Account already exists'});
  const otp=String(crypto.randomInt(100000,1000000));
  const requestId=id('otp');
  db.prepare('INSERT INTO otp_requests(id,phone,mode,otp_hash,expires_at,created_at,device_id) VALUES(?,?,?,?,?,?,?)').run(requestId,phone,mode,bcrypt.hashSync(otp,10),new Date(Date.now()+5*60e3).toISOString(),now(),String(req.body.deviceId||''));
  try{
    await sendOtp(phone,otp);
    console.log('[OTP] 2Factor send succeeded for phone ending',phone.slice(-4));
    res.json({ok:true,message:'OTP sent',requestId,mode});
  }catch(e){
    db.prepare('DELETE FROM otp_requests WHERE id=?').run(requestId);
    console.error('[OTP] 2Factor send failed:',e.message);
    res.status(503).json({error:e.message});
  }
});
app.post('/api/customer/auth/verify-otp',authLimiter,async(req,res)=>{
  const phone=normalizePhone(req.body.phone);
  const otp=String(req.body.otp||'');
  // Always verify the newest unverified OTP for this phone. Do not trust the
  // client-side authMode here: an older signup OTP must never push an already
  // registered customer into the signup form.
  const r=db.prepare('SELECT * FROM otp_requests WHERE phone=? AND verified=0 ORDER BY created_at DESC LIMIT 1').get(phone);
  if(!r||new Date(r.expires_at)<new Date())return res.status(400).json({error:'OTP expired or invalid'});
  if(r.attempts>=5)return res.status(429).json({error:'Too many OTP attempts'});
  db.prepare('UPDATE otp_requests SET attempts=attempts+1 WHERE id=?').run(r.id);
  if(!bcrypt.compareSync(otp,r.otp_hash))return res.status(400).json({error:'Invalid OTP'});
  db.prepare('UPDATE otp_requests SET verified=1 WHERE id=?').run(r.id);

  // Existing customers always go straight to Home after a valid OTP,
  // regardless of whether the OTP request was created as login/signup.
  const c=db.prepare('SELECT * FROM customers WHERE phone=?').get(phone);
  if(c)return res.json({token:signCustomer(c),customer:publicCustomer(c)});

  // Only a genuinely new number continues to profile/signup completion.
  if(r.mode==='signup')return res.json({pendingSignup:true,signupToken:jwt.sign({phone,otpId:r.id,role:'signup'},JWT_SECRET,{expiresIn:'10m'})});
  return res.status(404).json({error:'Account not found'});
});
function publicCustomer(c){return {id:c.id,name:c.name,phone:c.phone,email:c.email||'',gender:c.gender||'',dateOfBirth:c.date_of_birth||'',referralCode:c.referral_code||'',promotionalBalance:Number(c.promotional_balance||0),createdAt:c.created_at};}
app.post('/api/customer/auth/complete-signup',authLimiter,(req,res)=>{try{const p=jwt.verify(String(req.body.signupToken||''),JWT_SECRET);if(p.role!=='signup')throw Error('bad');const phone=normalizePhone(p.phone),name=String(req.body.name||'').trim();if(!name)return res.status(400).json({error:'Name is required'});if(db.prepare('SELECT id FROM customers WHERE phone=?').get(phone))return res.status(409).json({error:'Account already exists'});let code='MEB'+crypto.randomInt(100000,999999);while(db.prepare('SELECT id FROM customers WHERE referral_code=?').get(code))code='MEB'+crypto.randomInt(100000,999999);const cid=id('cus');db.prepare('INSERT INTO customers(id,name,phone,email,gender,date_of_birth,referral_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(cid,name,phone,String(req.body.email||'').trim(),String(req.body.gender||''),String(req.body.dateOfBirth||''),code,now(),now());const refCode=String(req.body.referralCode||'').trim().toUpperCase();if(refCode){if(!/^[A-Z0-9_-]{2,40}$/.test(refCode))return res.status(400).json({error:'Invalid referral code'});const referrer=db.prepare('SELECT * FROM customers WHERE referral_code=? AND id<>?').get(refCode,cid);if(!referrer)return res.status(400).json({error:'Invalid or expired referral code'});const already=db.prepare('SELECT id FROM referral_events WHERE referred_customer_id=?').get(cid);if(already)return res.status(409).json({error:'Referral already used for this account'});const reward=Number(getSetting('core',defaultSettings).referralReward||50);db.prepare('INSERT INTO referral_events(id,referrer_customer_id,referred_customer_id,referred_name,reward_amount,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id('ref'),referrer.id,cid,name,reward,'pending',now(),now());}const c=db.prepare('SELECT * FROM customers WHERE id=?').get(cid);res.json({token:signCustomer(c),customer:publicCustomer(c)});}catch(e){res.status(400).json({error:'Signup session expired. Please request OTP again.'})}});
app.post('/api/customer/auth/signup',(req,res)=>{const name=String(req.body.name||'').trim(),phone=normalizePhone(req.body.phone),password=String(req.body.password||'');if(!name||phone.length!==10||password.length<6)return res.status(400).json({error:'Name, valid phone and password (6+ chars) are required'});if(db.prepare('SELECT id FROM customers WHERE phone=?').get(phone))return res.status(409).json({error:'Account already exists'});let code='MEB'+crypto.randomInt(100000,999999);while(db.prepare('SELECT id FROM customers WHERE referral_code=?').get(code))code='MEB'+crypto.randomInt(100000,999999);const cid=id('cus');db.prepare('INSERT INTO customers(id,name,phone,email,password_hash,referral_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(cid,name,phone,String(req.body.email||'').trim(),bcrypt.hashSync(password,12),code,now(),now());const refCode=String(req.body.referralCode||'').trim().toUpperCase();if(refCode){if(!/^[A-Z0-9_-]{2,40}$/.test(refCode))return res.status(400).json({error:'Invalid referral code'});const referrer=db.prepare('SELECT * FROM customers WHERE referral_code=? AND id<>?').get(refCode,cid);if(!referrer)return res.status(400).json({error:'Invalid or expired referral code'});const already=db.prepare('SELECT id FROM referral_events WHERE referred_customer_id=?').get(cid);if(already)return res.status(409).json({error:'Referral already used for this account'});const reward=Number(getSetting('core',defaultSettings).referralReward||50);db.prepare('INSERT INTO referral_events(id,referrer_customer_id,referred_customer_id,referred_name,reward_amount,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id('ref'),referrer.id,cid,name,reward,'pending',now(),now());}const c=db.prepare('SELECT * FROM customers WHERE id=?').get(cid);res.status(201).json({token:signCustomer(c),customer:publicCustomer(c)});});
app.post('/api/customer/auth/login',(req,res)=>{const phone=normalizePhone(req.body.phone);const c=db.prepare('SELECT * FROM customers WHERE phone=?').get(phone);if(!c||!c.password_hash||!bcrypt.compareSync(String(req.body.password||''),c.password_hash))return res.status(401).json({error:'Invalid phone or password'});res.json({token:signCustomer(c),customer:publicCustomer(c)});});

app.get('/api/customer/me',requireCustomer,(req,res)=>res.json(publicCustomer(req.customer)));
app.put('/api/customer/me',requireCustomer,(req,res)=>{const name=String(req.body.name||req.customer.name).trim(),email=String(req.body.email||'').trim();db.prepare('UPDATE customers SET name=?,email=?,updated_at=? WHERE id=?').run(name,email,now(),req.customer.id);res.json(publicCustomer(db.prepare('SELECT * FROM customers WHERE id=?').get(req.customer.id)));});
app.put('/api/customer/password',requireCustomer,(req,res)=>{if(!req.customer.password_hash||!bcrypt.compareSync(String(req.body.currentPassword||''),req.customer.password_hash))return res.status(400).json({error:'Current password is incorrect'});if(String(req.body.newPassword||'').length<6)return res.status(400).json({error:'New password must be at least 6 characters'});db.prepare('UPDATE customers SET password_hash=?,updated_at=? WHERE id=?').run(bcrypt.hashSync(String(req.body.newPassword),12),now(),req.customer.id);res.json({ok:true});});
app.get('/api/customer/addresses',requireCustomer,(req,res)=>res.json(db.prepare('SELECT id,label,recipient_name recipientName,phone,address,latitude,longitude,is_default isDefault FROM addresses WHERE customer_id=? ORDER BY is_default DESC,created_at DESC').all(req.customer.id).map(a=>({...a,isDefault:!!a.isDefault}))));
app.post('/api/customer/addresses',requireCustomer,(req,res)=>saveAddress(req,res,null));
app.put('/api/customer/addresses/:id',requireCustomer,(req,res)=>saveAddress(req,res,req.params.id));
function saveAddress(req,res,addressId){const p=req.body;if(!String(p.address||'').trim())return res.status(400).json({error:'Address is required'});const t=now();if(addressId){const old=db.prepare('SELECT id FROM addresses WHERE id=? AND customer_id=?').get(addressId,req.customer.id);if(!old)return res.status(404).json({error:'Address not found'});db.prepare('UPDATE addresses SET label=?,recipient_name=?,phone=?,address=?,latitude=?,longitude=?,is_default=?,updated_at=? WHERE id=?').run(p.label||'Home',p.recipientName||req.customer.name,p.phone||req.customer.phone,p.address, p.latitude??null,p.longitude??null,p.isDefault?1:0,t,addressId);}else{addressId=id('addr');db.prepare('INSERT INTO addresses(id,customer_id,label,recipient_name,phone,address,latitude,longitude,is_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(addressId,req.customer.id,p.label||'Home',p.recipientName||req.customer.name,p.phone||req.customer.phone,p.address,p.latitude??null,p.longitude??null,p.isDefault?1:0,t,t);}if(p.isDefault)db.prepare('UPDATE addresses SET is_default=0 WHERE customer_id=? AND id<>?').run(req.customer.id,addressId);res.json(db.prepare('SELECT id,label,recipient_name recipientName,phone,address,latitude,longitude,is_default isDefault FROM addresses WHERE id=?').get(addressId));}

app.get('/api/customer/referral',requireCustomer,(req,res)=>{const c=req.customer;const refs=db.prepare('SELECT re.referred_name referredName,re.reward_amount rewardAmount,re.status,re.created_at createdAt FROM referral_events re WHERE re.referrer_customer_id=? ORDER BY re.created_at DESC').all(c.id);const code=c.referral_code;res.json({referralCode:code,referralLink:`${BASE||''}/?ref=${encodeURIComponent(code)}`,promotionalBalance:Number(c.promotional_balance||0),rewardAmount:Number(getSetting('core',defaultSettings).referralReward||50),stats:{total:refs.length,rewarded:refs.filter(x=>x.status==='rewarded').length,pending:refs.filter(x=>x.status==='pending').length,rejected:refs.filter(x=>x.status==='rejected').length},referrals:refs});});

app.get('/api/orders',async(req,res)=>{const c=customerFromReq(req);const phone=normalizePhone(req.query.phone);if(!c&&!phone)return res.status(401).json({error:'Authentication required'});const rows=c?db.prepare('SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC').all(c.id):db.prepare('SELECT * FROM orders WHERE phone=? ORDER BY created_at DESC').all(phone);res.json(rows.map(orderPublic));});
app.post('/api/orders',async(req,res)=>{const c=customerFromReq(req);const b=req.body||{};const items=Array.isArray(b.items)?b.items:[];if(!items.length||!String(b.name||'').trim()||normalizePhone(b.phone).length!==10||!String(b.address||'').trim())return res.status(400).json({error:'Name, valid phone, address and cart items are required'});const ids=items.map(x=>x.productId).filter(Boolean);let products=ids.length?db.prepare(`SELECT * FROM products WHERE id IN (${ids.map(()=>'?').join(',')}) AND published=1`).all(...ids):[];const map=new Map(products.map(p=>[p.id,p]));const clean=[];for(const x of items){const p=map.get(x.productId);if(!p)continue;const qty=Math.max(1,Math.min(20,Number(x.qty||1)));clean.push({productId:p.id,name:p.name,price:Number(p.price),qty,image:p.image||''});}if(!clean.length)return res.status(400).json({error:'Cart items are unavailable'});const subtotal=clean.reduce((s,x)=>s+x.price*x.qty,0);const fee=Number(getSetting('core',defaultSettings).deliveryFee||0);const coupon=couponValidate(b.couponCode,subtotal,fee);if(b.couponCode&& !coupon.valid)return res.status(400).json({error:'Invalid or unavailable coupon'});const discount=coupon.valid?coupon.discount:0;const total=Math.max(0,subtotal+fee-discount);const oid='MEB'+Date.now().toString().slice(-8)+crypto.randomInt(10,99);const accessToken=crypto.randomBytes(18).toString('hex');let razorOrder=null;const paymentMethod=String(b.paymentMethod||'COD').toUpperCase();if(paymentMethod==='ONLINE'&&process.env.ENABLE_ONLINE_PAYMENTS==='true'&&process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET){const rz=new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});razorOrder=await rz.orders.create({amount:Math.round(total*100),currency:'INR',receipt:oid,notes:{customerId:c?.id||'',orderId:oid}});}else if(paymentMethod==='ONLINE'){return res.status(503).json({error:'Online payment is disabled for the current launch. Please use Cash on Delivery.'});}
const tx=db.transaction(()=>{db.prepare('INSERT INTO orders(id,customer_id,name,phone,address,latitude,longitude,items_json,subtotal,delivery_fee,discount,total,status,payment_method,online_method,payment_status,razorpay_order_id,access_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(oid,c?.id||null,b.name.trim(),normalizePhone(b.phone),b.address,b.location?.latitude??null,b.location?.longitude??null,JSON.stringify(clean),subtotal,fee,discount,total,'Placed',paymentMethod,b.onlineMethod||null,paymentMethod==='COD'?'PENDING':'CREATED',razorOrder?.id||null,accessToken,now(),now());if(coupon.valid)db.prepare('UPDATE coupons SET used_count=used_count+1 WHERE id=?').run(coupon.coupon.id);db.prepare('INSERT INTO order_events(order_id,status,created_at) VALUES(?,?,?)').run(oid,'Placed',now());});tx();const o=db.prepare('SELECT * FROM orders WHERE id=?').get(oid);res.status(201).json({...orderPublic(o),accessToken,razorpay:razorOrder?{keyId:process.env.RAZORPAY_KEY_ID,orderId:razorOrder.id,amount:razorOrder.amount,currency:razorOrder.currency}:null});});
function orderPublic(o){return {id:o.id,name:o.name,phone:o.phone,address:o.address,latitude:o.latitude,longitude:o.longitude,items:parseJson(o.items_json,[]),subtotal:Number(o.subtotal),deliveryFee:Number(o.delivery_fee),discount:Number(o.discount),total:Number(o.total),status:o.status,paymentMethod:o.payment_method,onlineMethod:o.online_method,paymentStatus:o.payment_status,razorpayOrderId:o.razorpay_order_id,assignedRiderId:o.assigned_rider_id,createdAt:o.created_at,updatedAt:o.updated_at};}
app.get('/api/customer/orders/:id',requireCustomer,(req,res)=>{const o=db.prepare('SELECT * FROM orders WHERE id=? AND customer_id=?').get(req.params.id,req.customer.id);if(!o)return res.status(404).json({error:'Order not found'});res.json(orderPublic(o));});
app.get('/api/customer/orders/:id/tracking',requireCustomer,(req,res)=>{const o=db.prepare('SELECT * FROM orders WHERE id=? AND customer_id=?').get(req.params.id,req.customer.id);if(!o)return res.status(404).json({error:'Order not found'});const r=o.assigned_rider_id?db.prepare('SELECT * FROM riders WHERE id=?').get(o.assigned_rider_id):null;const e=db.prepare('SELECT * FROM order_events WHERE order_id=? ORDER BY created_at DESC LIMIT 1').get(o.id);res.json({delivered:o.status==='Delivered',location:r&&r.latitude!=null?{latitude:r.latitude,longitude:r.longitude,recordedAt:r.last_seen}:e&&e.lat!=null?{latitude:e.lat,longitude:e.lon,recordedAt:e.created_at}:null,distanceKm:null,etaMin:null});});
app.get('/api/customer/orders/:id/rating',requireCustomer,(req,res)=>{const r=db.prepare('SELECT rating,review FROM ratings WHERE order_id=? AND customer_id=?').get(req.params.id,req.customer.id);res.json(r||{});});
app.post('/api/customer/orders/:id/rating',requireCustomer,(req,res)=>{const o=db.prepare('SELECT id FROM orders WHERE id=? AND customer_id=?').get(req.params.id,req.customer.id);if(!o)return res.status(404).json({error:'Order not found'});const rating=Math.max(1,Math.min(5,Number(req.body.rating||0)));if(!rating)return res.status(400).json({error:'Rating required'});const t=now();db.prepare('INSERT INTO ratings(id,order_id,customer_id,rating,review,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET rating=excluded.rating,review=excluded.review,updated_at=excluded.updated_at').run(id('rate'),req.params.id,req.customer.id,rating,String(req.body.review||'').slice(0,2000),t,t);res.json({rating,review:String(req.body.review||'').slice(0,2000),saved:true});});

app.post('/api/admin/login',authLimiter,(req,res)=>{if(!process.env.ADMIN_PASSWORD||String(req.body.password||'')!==process.env.ADMIN_PASSWORD)return res.status(401).json({error:'Invalid admin credentials'});res.json({ok:true,adminKey:process.env.ADMIN_PASSWORD});});
app.get('/api/admin/dashboard',requireAdmin,(req,res)=>{const counts={customers:db.prepare('SELECT COUNT(*) c FROM customers').get().c,orders:db.prepare('SELECT COUNT(*) c FROM orders').get().c,pendingOrders:db.prepare("SELECT COUNT(*) c FROM orders WHERE status NOT IN ('Delivered','Cancelled')").get().c,products:db.prepare('SELECT COUNT(*) c FROM products').get().c,coupons:db.prepare('SELECT COUNT(*) c FROM coupons').get().c,riders:db.prepare('SELECT COUNT(*) c FROM riders WHERE active=1').get().c};res.json({counts,orders:db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 50').all().map(orderPublic),products:allProductList(),coupons:db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all(),riders:db.prepare('SELECT id,name,phone,active,latitude,longitude,last_seen,created_at FROM riders ORDER BY name').all()});});
app.put('/api/admin/settings',requireAdmin,(req,res)=>{setSetting('core',{...defaultSettings,...req.body});res.json(getSetting('core',defaultSettings));});
app.post('/api/admin/products',requireAdmin,(req,res)=>{const p=req.body,idv=p.id||id('p');db.prepare('INSERT INTO products(id,name,en,category,price,desc,image,video,published,sort_order,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,en=excluded.en,category=excluded.category,price=excluded.price,desc=excluded.desc,image=excluded.image,video=excluded.video,published=excluded.published,sort_order=excluded.sort_order,updated_at=excluded.updated_at').run(idv,p.name,p.en||'',p.category||'Menu',Number(p.price||0),p.desc||'',p.image||'',p.video||'',p.published===false?0:1,Number(p.sort_order||0),now());res.json(db.prepare('SELECT * FROM products WHERE id=?').get(idv));});
app.delete('/api/admin/products/:id',requireAdmin,(req,res)=>{db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);res.json({ok:true});});
app.post('/api/admin/coupons',requireAdmin,(req,res)=>{const p=req.body,code=String(p.code||'').trim().toUpperCase();if(!code)return res.status(400).json({error:'Coupon code required'});const cid=p.id||id('cp');try{db.prepare('INSERT INTO coupons(id,code,description,discount_type,discount_value,min_order,max_discount,starts_at,expires_at,usage_limit,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,description=excluded.description,discount_type=excluded.discount_type,discount_value=excluded.discount_value,min_order=excluded.min_order,max_discount=excluded.max_discount,starts_at=excluded.starts_at,expires_at=excluded.expires_at,usage_limit=excluded.usage_limit,published=excluded.published,updated_at=excluded.updated_at').run(cid,code,p.description||'',String(p.discount_type||p.discountType||'FIXED').toUpperCase(),Number(p.discount_value??p.discountValue??0),Number(p.min_order??p.minOrder??0),p.max_discount??p.maxDiscount??null,p.starts_at??p.startsAt??null,p.expires_at??p.expiresAt??null,p.usage_limit??p.usageLimit??null,p.published?1:0,now(),now());res.json(db.prepare('SELECT * FROM coupons WHERE id=?').get(cid));}catch(e){res.status(409).json({error:'Coupon code already exists'});}});
app.delete('/api/admin/coupons/:id',requireAdmin,(req,res)=>{db.prepare('DELETE FROM coupons WHERE id=?').run(req.params.id);res.json({ok:true});});
app.patch('/api/admin/orders/:id',requireAdmin,(req,res)=>updateOrderStatus(req,res));
function updateOrderStatus(req,res){const allowed=['Placed','Confirmed','Preparing','Ready for Pickup','Out for Delivery','Delivered','Cancelled'];const status=String(req.body.status||'');if(!allowed.includes(status))return res.status(400).json({error:'Invalid order status'});const o=db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);if(!o)return res.status(404).json({error:'Order not found'});db.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?').run(status,now(),o.id);db.prepare('INSERT INTO order_events(order_id,status,note,created_at) VALUES(?,?,?,?)').run(o.id,status,String(req.body.note||''),now());if(status==='Delivered'&&o.customer_id){const re=db.prepare('SELECT * FROM referral_events WHERE referred_customer_id=? AND status="pending"').get(o.customer_id);if(re){db.prepare('UPDATE referral_events SET status="rewarded",updated_at=? WHERE id=?').run(now(),re.id);db.prepare('UPDATE customers SET promotional_balance=promotional_balance+?,updated_at=? WHERE id=?').run(re.reward_amount,now(),re.referrer_customer_id);}}res.json(orderPublic(db.prepare('SELECT * FROM orders WHERE id=?').get(o.id)));}
app.post('/api/admin/riders',requireAdmin,(req,res)=>{const p=req.body;if(!p.name||!p.phone||!p.password)return res.status(400).json({error:'name, phone and password required'});const rid=p.id||id('rider');try{db.prepare('INSERT INTO riders(id,name,phone,password_hash,active,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,active=excluded.active').run(rid,p.name,normalizePhone(p.phone),bcrypt.hashSync(p.password,12),p.active===false?0:1,now());res.json({id:rid,name:p.name,phone:normalizePhone(p.phone)});}catch(e){res.status(409).json({error:'Rider phone already exists'});}});
app.post('/api/admin/assign-rider/:orderId',requireAdmin,(req,res)=>{const o=db.prepare('SELECT id FROM orders WHERE id=?').get(req.params.orderId),r=db.prepare('SELECT id FROM riders WHERE id=? AND active=1').get(req.body.riderId);if(!o||!r)return res.status(404).json({error:'Order or rider not found'});db.prepare('UPDATE orders SET assigned_rider_id=?,updated_at=? WHERE id=?').run(r.id,now(),o.id);res.json(orderPublic(db.prepare('SELECT * FROM orders WHERE id=?').get(o.id)));});
app.post('/api/admin/referrals/:id/approve',requireAdmin,(req,res)=>{const re=db.prepare('SELECT * FROM referral_events WHERE id=?').get(req.params.id);if(!re)return res.status(404).json({error:'Referral not found'});db.prepare('UPDATE referral_events SET status="rewarded",updated_at=? WHERE id=?').run(now(),re.id);db.prepare('UPDATE customers SET promotional_balance=promotional_balance+?,updated_at=? WHERE id=?').run(re.reward_amount,now(),re.referrer_customer_id);res.json({ok:true});});

app.post('/api/rider/login',authLimiter,(req,res)=>{const r=db.prepare('SELECT * FROM riders WHERE phone=? AND active=1').get(normalizePhone(req.body.phone));if(!r||!bcrypt.compareSync(String(req.body.password||''),r.password_hash))return res.status(401).json({error:'Invalid rider credentials'});res.json({token:signRider(r),rider:{id:r.id,name:r.name,phone:r.phone}});});
app.get('/api/rider/orders',requireRider,(req,res)=>res.json(db.prepare("SELECT * FROM orders WHERE assigned_rider_id=? AND status NOT IN ('Delivered','Cancelled') ORDER BY created_at DESC").all(req.rider.id).map(orderPublic)));
app.patch('/api/rider/orders/:id/status',requireRider,(req,res)=>{const o=db.prepare('SELECT * FROM orders WHERE id=? AND assigned_rider_id=?').get(req.params.id,req.rider.id);if(!o)return res.status(404).json({error:'Order not assigned to this rider'});return updateOrderStatus({body:req.body,params:req.params},res);});
app.post('/api/rider/location',requireRider,(req,res)=>{const lat=Number(req.body.latitude),lon=Number(req.body.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return res.status(400).json({error:'Invalid coordinates'});db.prepare('UPDATE riders SET latitude=?,longitude=?,last_seen=? WHERE id=?').run(lat,lon,now(),req.rider.id);const active=db.prepare("SELECT id FROM orders WHERE assigned_rider_id=? AND status NOT IN ('Delivered','Cancelled')").all(req.rider.id);const tx=db.transaction(()=>active.forEach(o=>db.prepare('INSERT INTO order_events(order_id,lat,lon,note,created_at) VALUES(?,?,?,?,?)').run(o.id,lat,lon,'Rider GPS update',now())));tx();res.json({ok:true});});
app.get('/api/rider/me',requireRider,(req,res)=>res.json({id:req.rider.id,name:req.rider.name,phone:req.rider.phone,latitude:req.rider.latitude,longitude:req.rider.longitude,lastSeen:req.rider.last_seen}));

app.post('/api/payments/razorpay/verify',async(req,res)=>{const {orderId,razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body;const o=db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);if(!o||!process.env.RAZORPAY_KEY_SECRET)return res.status(400).json({error:'Payment verification unavailable'});const h=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');if(h!==razorpay_signature)return res.status(400).json({error:'Invalid payment signature'});db.prepare('UPDATE orders SET payment_status="PAID",razorpay_payment_id=?,updated_at=? WHERE id=? AND razorpay_order_id=?').run(razorpay_payment_id,now(),orderId,razorpay_order_id);res.json({ok:true});});
app.post('/api/payments/razorpay/webhook',(req,res)=>{if(!process.env.RAZORPAY_WEBHOOK_SECRET)return res.sendStatus(204);const signature=req.headers['x-razorpay-signature'];const raw=JSON.stringify(req.body);const h=crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');if(signature!==h)return res.status(400).send('invalid signature');const event=req.body?.event;if(event==='payment.captured'){const p=req.body.payload?.payment?.entity; if(p?.order_id)db.prepare('UPDATE orders SET payment_status="PAID",razorpay_payment_id=?,updated_at=? WHERE razorpay_order_id=?').run(p.id,now(),p.order_id);}res.json({ok:true});});

app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'admin.html')));
app.get('/rider',(req,res)=>res.sendFile(path.join(__dirname,'rider.html')));
app.get(/.*/,(req,res)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'API route not found'});res.sendFile(path.join(__dirname,'index.html'));});
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Internal server error'});});
app.listen(PORT,()=>console.log(`MI EXPRESS BIRYANI running on :${PORT}`));
