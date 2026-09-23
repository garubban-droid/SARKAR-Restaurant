CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id=1),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO settings(id,data) VALUES(1,'{}') ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  en TEXT DEFAULT '',
  category TEXT DEFAULT '',
  price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(price>=0),
  description TEXT DEFAULT '',
  image TEXT DEFAULT '',
  video TEXT DEFAULT '',
  published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  referral_code TEXT UNIQUE,
  referred_by_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  device_fingerprint_hash TEXT,
  signup_ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_device_hash_idx ON customers(device_fingerprint_hash) WHERE device_fingerprint_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Home',
  recipient_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_addresses_customer_idx ON customer_addresses(customer_id,is_default DESC,created_at DESC);

CREATE TABLE IF NOT EXISTS riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  online BOOLEAN NOT NULL DEFAULT false,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  dob DATE,
  email TEXT NOT NULL DEFAULT '',
  full_address TEXT NOT NULL DEFAULT '',
  pin_code TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT NOT NULL CHECK(discount_type IN ('PERCENT','FIXED','FREE_DELIVERY')),
  discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_order NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_discount NUMERIC(12,2),
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  show_on_checkout BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  items JSONB NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL CHECK(subtotal>=0),
  delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(delivery_fee>=0),
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(discount_amount>=0),
  coupon_code TEXT,
  total NUMERIC(12,2) NOT NULL CHECK(total>=0),
  status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','ACCEPTED','PREPARING','READY','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
  payment_method TEXT NOT NULL DEFAULT 'COD' CHECK(payment_method IN ('COD','ONLINE')),
  payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(payment_status IN ('PENDING','PAID','FAILED','REFUNDED')),
  online_method TEXT,
  delivery_slot TEXT DEFAULT 'ASAP',
  scheduled_at TIMESTAMPTZ,
  access_token_hash TEXT,
  delivery_latitude DOUBLE PRECISION,
  delivery_longitude DOUBLE PRECISION,
  assigned_rider_id UUID REFERENCES riders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS orders_phone_idx ON orders(phone);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS orders_access_token_hash_idx ON orders(access_token_hash) WHERE access_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_order_id TEXT UNIQUE,
  provider_payment_id TEXT,
  amount BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL,
  signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(order_id);

CREATE TABLE IF NOT EXISTS delivery_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now()+interval '24 hours')
);

CREATE TABLE IF NOT EXISTS tracking_points (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  accuracy DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tracking_points_order_time_idx ON tracking_points(order_id,recorded_at DESC);

CREATE TABLE IF NOT EXISTS customer_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_otps_phone_idx ON customer_otps(phone,created_at DESC);

CREATE TABLE IF NOT EXISTS customer_order_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  review TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_order_ratings_product ON customer_order_ratings(product_id);

CREATE TABLE IF NOT EXISTS referral_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO referral_settings(id,data) VALUES(1,'{}') ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS customer_referrals (
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
);
CREATE INDEX IF NOT EXISTS customer_referrals_referrer_idx ON customer_referrals(referrer_customer_id,joined_at DESC);
CREATE INDEX IF NOT EXISTS customer_referrals_status_idx ON customer_referrals(status,joined_at DESC);

CREATE TABLE IF NOT EXISTS referral_fraud_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID REFERENCES customer_referrals(id) ON DELETE SET NULL,
  referred_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  signal_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'MEDIUM',
  details TEXT NOT NULL DEFAULT '',
  device_hash TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_fraud_signals_time_idx ON referral_fraud_signals(created_at DESC);

CREATE TABLE IF NOT EXISTS customer_wallets (
  customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  promotional_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_referral_once_idx ON wallet_transactions(reference_type,reference_id) WHERE reference_type='REFERRAL' AND reference_id<>'';
