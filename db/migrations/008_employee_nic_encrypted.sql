-- Admins need to see an employee's NIC on the Lists page so they can spot and fix
-- a mistyped NIC when someone reports they can't register or vote. The full NIC
-- is stored AES-256-GCM encrypted (key derived from NIC_PEPPER, see
-- app/core/nic-crypto.js); nic_last4_hash stays the only thing verification uses.
--
-- Existing employees have NULL here until their NIC is re-imported or edited.
-- app_runtime already has SELECT/INSERT/UPDATE on employees (migration 001).
ALTER TABLE employees ADD COLUMN nic_encrypted text;
