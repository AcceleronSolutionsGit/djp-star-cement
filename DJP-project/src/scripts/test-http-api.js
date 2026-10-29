import http from 'http';
import express from 'express';
import apiRoutes from '../routes/api.routes.js';
import { dbGet } from '../config/database.js';

async function testHttpEndpoints() {
  console.log('--- Testing Live Express HTTP Endpoints ---');

  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Ephemeral test server running at ${baseUrl}`);

  try {
    // 1. Test GET /api/sync/customer-coordinates/status
    console.log('\nTesting GET /api/sync/customer-coordinates/status...');
    const statusRes = await fetch(`${baseUrl}/api/sync/customer-coordinates/status`);
    console.log(`Status HTTP code: ${statusRes.status}`);
    const statusJson = await statusRes.json();
    console.log('Status Response:', statusJson);
    if (statusRes.status !== 200 || !statusJson.totalCoordinatesCached) {
      throw new Error('Status endpoint failed');
    }

    // 2. Test GET /api/app/plans/:planId/route-map
    const latestPlan = await dbGet('SELECT id, emp_code, emp_name FROM sales_plans ORDER BY id DESC LIMIT 1');
    console.log(`\nTesting GET /api/app/plans/${latestPlan.id}/route-map for ${latestPlan.emp_name}...`);
    const routeRes = await fetch(`${baseUrl}/api/app/plans/${latestPlan.id}/route-map`);
    console.log(`Route Map HTTP code: ${routeRes.status}`);
    const routeJson = await routeRes.json();
    console.log(`Plan ID: ${routeJson.planId}, Total Distance: ${routeJson.totalDistanceKm} km, Days: ${routeJson.totalDays}`);
    if (routeRes.status !== 200 || !routeJson.success || !Array.isArray(routeJson.days)) {
      throw new Error('Route Map endpoint failed');
    }

    // 3. Test GET /api/app/officers/:empCode/plans/:planId/route-map
    console.log(`\nTesting GET /api/app/officers/${latestPlan.emp_code}/plans/${latestPlan.id}/route-map...`);
    const officerRouteRes = await fetch(`${baseUrl}/api/app/officers/${latestPlan.emp_code}/plans/${latestPlan.id}/route-map`);
    console.log(`Officer Route Map HTTP code: ${officerRouteRes.status}`);
    const officerRouteJson = await officerRouteRes.json();
    if (officerRouteRes.status !== 200 || !officerRouteJson.success) {
      throw new Error('Officer Route Map endpoint failed');
    }

    console.log('\n✓ ALL LIVE HTTP API ENDPOINTS TESTED SUCCESSFULLY!');
  } finally {
    server.close();
  }
  process.exit(0);
}

testHttpEndpoints().catch(err => {
  console.error('HTTP test failed:', err);
  process.exit(1);
});

