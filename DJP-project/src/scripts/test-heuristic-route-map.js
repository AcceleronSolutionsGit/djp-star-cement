import { dbGet, dbAll, dbRun, pool } from '../config/database.js';
import { AutoPlanGenerator } from '../engines/autoPlanGenerator.js';
import { getCoordinatesForDealers } from '../services/customerCoordinates.service.js';
import { haversineDistanceKm, optimizeDayRoute, clusterAndScheduleHeuristicRoutes } from '../engines/heuristicRouting.engine.js';

async function runTest() {
  console.log('--- Testing Customer Coordinates & Heuristic Routing ---');

  // 1. Verify master_customer_coordinates table
  const countRes = await dbGet('SELECT COUNT(*) as cnt FROM master_customer_coordinates');
  console.log('Total coordinates in DB:', countRes?.cnt);

  // 2. Test Coordinates lookup
  const sampleDealers = ['A163', 'B138', 'S001', 'SDNE10296'];
  const coordsMap = await getCoordinatesForDealers(sampleDealers);
  console.log('Sample Coordinates lookup:');
  for (const code of sampleDealers) {
    console.log(`  ${code}:`, coordsMap.get(code) || 'Not found');
  }

  // 3. Test Haversine Distance
  const d = haversineDistanceKm(26.1445, 91.7362, 26.1850, 91.7770);
  console.log(`Haversine test distance: ${d.toFixed(2)} km`);

  // 4. Test TSP optimization on a small mock route
  const mockStops = [
    { dealer_sap_code: 'STOP_1', latitude: 26.11, longitude: 91.70, dealer_name: 'Stop 1' },
    { dealer_sap_code: 'STOP_3', latitude: 26.19, longitude: 91.80, dealer_name: 'Stop 3' },
    { dealer_sap_code: 'STOP_2', latitude: 26.14, longitude: 91.74, dealer_name: 'Stop 2' },
  ];
  const optimized = optimizeDayRoute(mockStops);
  console.log('TSP Optimization order:', optimized.orderedVisits.map(s => `${s.dealer_name} (seq: ${s.sequence}, dist: ${s.distance_from_prev_km}km)`));
  console.log(`Day total distance: ${optimized.totalDistanceKm} km, polyline points: ${optimized.polyline.length}`);

  // 5. Test auto plan generation for an SO
  const soUser = await dbGet(`
    SELECT emp_code, emp_name, designation
    FROM master_employees
    WHERE designation LIKE '%SO%' OR designation LIKE '%OFFICER%'
    LIMIT 1
  `);
  console.log('Selected test SO:', soUser);

  let planResult = null;
  if (soUser) {
    const generator = new AutoPlanGenerator();
    planResult = await generator.generatePlan(
      soUser.emp_code,
      '2026-07',
      'SO',
      'C1',
      { createdBy: 'SYSTEM_TEST' }
    );
    console.log('Plan generated successfully!');
    console.log(`  Plan ID: ${planResult.planId}`);
    console.log(`  Total Visits: ${planResult.totalVisitsScheduled}`);
    console.log(`  Total Working Days: ${planResult.workingDaysCount}`);
    console.log(`  Total Distance: ${planResult.totalDistanceKm} km`);
  }

  // 6. Verify sales_plan_details columns populated
  const detailsSample = await dbAll(`
    SELECT id, plan_id, visit_date, sequence, dealer_sap_code, dealer_name,
           latitude, longitude, distance_from_prev_km, route_name
    FROM sales_plan_details
    ORDER BY id DESC
    LIMIT 5
  `);
  console.log('Latest 5 visits in sales_plan_details:');
  console.table(detailsSample);

  // 7. Test getPlanRouteMap controller
  const { getPlanRouteMap } = await import('../controllers/appPlan.controller.js');
  let routeMapResult = null;
  const currentPlanId = planResult?.planId || 21;
  const mockReq = { params: { planId: currentPlanId } };
  const mockRes = {
    status: (code) => ({
      json: (data) => {
        console.error('RouteMap error response:', code, data);
        return data;
      }
    }),
    json: (data) => {
      routeMapResult = data;
      return data;
    }
  };

  await getPlanRouteMap(mockReq, mockRes);
  if (routeMapResult && routeMapResult.success) {
    console.log(`--- Route Map API Output for Plan ${currentPlanId} ---`);
    console.log(`Plan ID: ${routeMapResult.planId}`);
    console.log(`Employee: ${routeMapResult.empName} (${routeMapResult.empCode})`);
    console.log(`Total Distance: ${routeMapResult.totalDistanceKm} km across ${routeMapResult.totalDays} days`);
    console.log(`Sample Day with Multiple Stops:`);
    const multiDay = routeMapResult.days.find(d => d.visitCount > 1) || routeMapResult.days[0];
    if (multiDay) {
      console.log(`  Date: ${multiDay.visitDate}, Visits: ${multiDay.visitCount}, Distance: ${multiDay.totalDistanceKm} km, Stops with GPS: ${multiDay.hasCoordinatesCount}`);
      console.log(`  Stops:`);
      multiDay.stops.forEach(s => {
        console.log(`    [Seq ${s.sequence}] ${s.dealerName} (${s.dealerSapCode}) - Route: ${s.routeName} - Lat/Lng: ${s.latitude}, ${s.longitude} (+${s.distanceFromPrevKm} km)`);
      });
      console.log(`  Polyline coords:`, JSON.stringify(multiDay.polyline));
    }
  } else {
    console.error(`Failed to get route map for plan ${currentPlanId}:`, routeMapResult);
  }

  console.log('--- All Tests Completed Successfully ---');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
