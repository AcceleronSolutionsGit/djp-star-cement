import db from '../config/database.js';

db.all(`SELECT * FROM dealer_visit_targets WHERE sap_code = '1000003100' OR dealer_name LIKE '%ACHUMI%'`, [], (err, rows) => {
  if (err) {
    console.error(err);
  } else {
    console.log('--- Achumi Target Rows in Database ---');
    console.log(rows);
  }
  process.exit(0);
});
