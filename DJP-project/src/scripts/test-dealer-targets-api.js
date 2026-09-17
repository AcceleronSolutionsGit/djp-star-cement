import { getDealerVisitTargets } from '../controllers/djp.controller.js';

async function testApi() {
  const req = { query: {} };
  const res = {
    json: (data) => {
      console.log('API Response Total:', data.total);
      if (data.targets && data.targets.length > 0) {
        console.log('Sample Target with Percentage Fields:');
        console.log(data.targets[0]);
      }
    },
    status: (code) => {
      console.error('API Error Status:', code);
      return res;
    }
  };

  await getDealerVisitTargets(req, res);
}

testApi().catch(console.error);
