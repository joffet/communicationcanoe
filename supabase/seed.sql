-- Dev seed data (tenants, teams — users created via auth signup in dev)
--
-- After first login, promote a user to platform super admin:
--   UPDATE users SET platform_role = 'super_admin' WHERE email = 'you@example.com';
-- Or set SUPER_ADMIN_EMAILS=you@example.com in apps/web/.env.local before signing in.

INSERT INTO tenants (id, name, twilio_number, inbound_email_address)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'Acme Support',
    '+15551234567',
    'support@acme.example'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Beta Retail',
    '+15559876543',
    'help@beta.example'
  );

INSERT INTO tenant_settings (tenant_id, greeting_message, business_hours, faq_snippets)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'Thanks for contacting Acme Support.',
    '{"timezone":"America/New_York","hours":{"mon-fri":"9:00-17:00"}}'::jsonb,
    '[{"q":"What are your hours?","a":"Monday–Friday, 9am–5pm ET."}]'::jsonb
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Hello from Beta Retail!',
    '{"timezone":"America/Los_Angeles","hours":{"mon-sat":"10:00-18:00"}}'::jsonb,
    '[]'::jsonb
  );

INSERT INTO teams (id, tenant_id, name)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'General'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'Billing'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'Support');

-- Sample identity + conversation for local UI testing (no auth user required for webhook path)
INSERT INTO identities (id, tenant_id, phone, email, name)
VALUES (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '11111111-1111-1111-1111-111111111111',
  '+15551112222',
  'customer@example.com',
  'Jane Customer'
);

INSERT INTO conversations (id, tenant_id, identity_id, status, assigned_team_id)
VALUES (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  '11111111-1111-1111-1111-111111111111',
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'open',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
);

INSERT INTO messages (tenant_id, conversation_id, channel, direction, sender_type, body)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'sms',
    'inbound',
    'external',
    'Hi, I need help with my order.'
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'sms',
    'outbound',
    'internal_user',
    'Thanks for reaching out — we will look into this shortly.'
  );
