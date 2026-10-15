PRAGMA foreign_keys = ON;
CREATE TABLE events (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 start TEXT NOT NULL, end TEXT NOT NULL, deadline TEXT NOT NULL,
 price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 0 AND 1000000),
 capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 10000),
 status TEXT NOT NULL CHECK(status IN ('draft','published','closed','cancelled')),
 policy TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE orders (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), email TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 8), total_cents INTEGER NOT NULL CHECK(total_cents>=0),
 status TEXT NOT NULL CHECK(status IN ('creating','held','paid','released','refunded')),
 source TEXT NOT NULL CHECK(source IN ('online','store')), stripe_session TEXT UNIQUE, payment_intent TEXT,
 checkout_url TEXT, checkout_payload TEXT, expires_at INTEGER NOT NULL, receipt_token TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 email_sent_at TEXT, email_error TEXT
);
CREATE INDEX orders_event_status ON orders(event_id,status);
CREATE TABLE attendees (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), name TEXT NOT NULL,
 checked_in INTEGER NOT NULL DEFAULT 0 CHECK(checked_in IN (0,1))
);
CREATE TABLE payment_events (id TEXT PRIMARY KEY, received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE request_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE audit_log (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
-- The capacity check executes inside the write transaction, never as a browser read-then-write.
CREATE TRIGGER reserve_capacity BEFORE INSERT ON orders BEGIN
 SELECT RAISE(ABORT,'Registration is closed') WHERE NOT EXISTS (SELECT 1 FROM events WHERE id=NEW.event_id AND status='published' AND julianday(deadline)>julianday('now') AND julianday(start)>julianday('now'));
 SELECT RAISE(ABORT,'Not enough seats remaining') WHERE NEW.quantity + COALESCE((SELECT SUM(quantity) FROM orders WHERE event_id=NEW.event_id AND status IN ('creating','held','paid','refunded')),0) > (SELECT capacity FROM events WHERE id=NEW.event_id);
END;
CREATE TRIGGER protect_capacity BEFORE UPDATE OF capacity ON events BEGIN
 SELECT RAISE(ABORT,'Capacity is below existing reservations') WHERE NEW.capacity < COALESCE((SELECT SUM(quantity) FROM orders WHERE event_id=NEW.id AND status IN ('creating','held','paid','refunded')),0);
END;
CREATE TRIGGER immutable_order_seats BEFORE UPDATE OF quantity,event_id ON orders BEGIN
 SELECT RAISE(ABORT,'Order seats cannot be changed');
END;
CREATE TRIGGER no_reactivate_released BEFORE UPDATE OF status ON orders WHEN OLD.status='released' AND NEW.status!='released' BEGIN
 SELECT RAISE(ABORT,'Released orders cannot be reactivated');
END;
