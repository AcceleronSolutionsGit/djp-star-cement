import { getDealerVisitTargets } from '../controllers/djp.controller.js';

async function testApi() {
  const req = {
    query: {
      periodMonth: '2026-10',
      limit: '10',
      offset: '0'
    }
  };
  const res = {
    json: (data) => {
      console.log('Total targets:', data.total);
      console.log('Sample rows:');
      for (const r of data.targets.slice(0, 5)) {
        console.log(`- ${r.dealer_name} | SAP: ${r.sap_code} | SFA: ${r.sfa_code} | cust_type: ${r.cust_type} | dealer_type: ${r.dealer_type}`);
      }
    },
    status: (code) => ({ json: (err) => console.error('Status', code, err) })
  };

  await getDealerVisitTargets(req, res);

  // Now test querying custType: 'RSAR'
  const reqRsar = {
    query: {
      periodMonth: '2026-10',
      custType: 'RSAR',
      limit: '5',
      offset: '0'
    }
  };
  const resRsar = {
    json: (data) => {
      console.log('\nQuery custType=RSAR total:', data.total);
      for (const r of data.targets.slice(0, 3)) {
        console.log(`- ${r.dealer_name} | SAP: ${r.sap_code} | SFA: ${r.sfa_code} | cust_type: ${r.cust_type} | dealer_type: ${r.dealer_type}`);
      }
    },
    status: (code) => ({ json: (err) => console.error('Status', code, err) })
  };
  await getDealerVisitTargets(reqRsar, resRsar);

  process.exit(0);
}

testApi().catch(console.error);
