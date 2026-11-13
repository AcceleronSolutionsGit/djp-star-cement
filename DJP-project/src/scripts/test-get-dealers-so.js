import { getDealersForSO } from '../controllers/plan.controller.js';

async function testGetDealers() {
  const req = {
    query: {
      empCode: '2500005', // ARPAN SARMA
      role: 'SO'
    }
  };
  const res = {
    json: (data) => {
      console.log('Total dealers for SO 2500005:', data.dealers?.length);
      const types = {};
      for (const d of data.dealers || []) {
        types[d.dealer_type] = (types[d.dealer_type] || 0) + 1;
      }
      console.log('Distribution of dealer_type for SO 2500005:', types);
      console.log('Sample 5 dealers:', data.dealers?.slice(0, 5));
    },
    status: (code) => ({ json: (err) => console.error(code, err) })
  };

  await getDealersForSO(req, res);
  process.exit(0);
}

testGetDealers().catch(console.error);

