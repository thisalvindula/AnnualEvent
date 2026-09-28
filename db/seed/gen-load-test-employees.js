// Generates a CSV of synthetic employees for k6 load testing, printed to
// stdout so it can be piped straight into the import endpoint:
//
//   node db/seed/gen-load-test-employees.js 800 > /tmp/load-test-employees.csv
//   curl -sk -b cookies.txt -H "Content-Type: text/csv" -H "x-csrf-token: $CSRF" \
//     --data-binary @/tmp/load-test-employees.csv \
//     https://localhost/admin/api/employees/import
//
// IMPORTANT: the emp_id and last4 scheme here (LT#### / a NIC whose last 4
// digits are 1000+n) is duplicated in tests/k6/raffle-load.js and
// tests/k6/vote-load.js so each virtual user can compute its own login
// without reading this file. If you change the scheme here, update both k6
// scripts too (each has a comment pointing back to this file).

const count = Number(process.argv[2] ?? 800);

console.log('emp_id,name,dept,nic');
for (let n = 1; n <= count; n++) {
  const empId = 'LT' + String(n).padStart(4, '0');
  const last4 = String(1000 + n).slice(-4);
  const nic = '19900000' + last4; // 12-digit new-format NIC, last 4 digits = last4
  console.log(`${empId},Load Test ${n},LoadTest,${nic}`);
}
