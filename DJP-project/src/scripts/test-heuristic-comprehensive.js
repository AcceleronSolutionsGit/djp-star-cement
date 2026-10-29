process.env.NODE_ENV = 'test';
import { dbGet, dbAll, dbRun } from '../config/database.js';
import { AutoPlanGenerator } from '../engines/autoPlanGenerator.js';
import { getCoordinatesForDealers, getCustomerCoordinateStatus } from '../services/customerCoordinates.service.js';
import { 
  haversineDistanceKm, 
  optimizeDayRoute, 
  clusterAndScheduleHeuristicRoutes 
} from '../engines/heuristicRouting.engine.js';
import { 
  getPlanRouteMap, 
  moveVisit, 
  removeVisit 
} from '../controllers/appPlan.controller.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runComprehensiveTests() {
  console.log('===============================================================');
  console.log('  STARTING COMPREHENSIVE HEURISTIC ROUTE MAP TEST SUITE');
  console.log('===============================================================\n');

  // -------------------------------------------------------------------------
  // TEST SUITE 1: Coordinates Ingestion & Lookup
  // -------------------------------------------------------------------------
  console.log('--- Test Suite 1: SFA Customer Coordinates Database & Service ---');
  const coordStatus = await getCustomerCoordinateStatus();
  console.log('Coordinate status:', coordStatus);
  assert(coordStatus.totalCoordinatesCached >= 30000, `Coordinates cache is populated with ${coordStatus.totalCoordinatesCached} records (>= 30,000)`);
  assert(coordStatus.dealersWithGps > 100, `Dealers with GPS coordinates is ${coordStatus.dealersWithGps} (> 100)`);

  const testCodes = ['B138', 'A163', 'SDNE10296'];
  const fetchedMap = await getCoordinatesForDealers(testCodes);
  assert(fetchedMap.size >= 3, `Lookup returned Map with ${fetchedMap.size} entries`);
  for (const c of testCodes) {
    const item = fetchedMap.get(c);
    assert(item && item.hasCoordinates && item.lat > 0 && item.lng > 0, `Dealer ${c} has valid GPS (${item?.lat}, ${item?.lng}) and route '${item?.routeName}'`);
  }

  // -------------------------------------------------------------------------
  // TEST SUITE 2: Heuristic Algorithmic Core (Distance, TSP, 2-Opt)
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 2: Algorithmic Routing Engine (Haversine & 2-Opt TSP) ---');
  // 2a. Haversine known distance check (Agartala ~23.83, 91.28 to Guwahati ~26.14, 91.73 is ~260 km)
  const distAgtGhy = haversineDistanceKm(23.83, 91.28, 26.14, 91.73);
  assert(distAgtGhy > 250 && distAgtGhy < 270, `Haversine distance Agartala-Guwahati is ${distAgtGhy.toFixed(1)} km (expected ~260 km)`);

  // 2b. Zero distance for identical points
  const distZero = haversineDistanceKm(23.83, 91.28, 23.83, 91.28);
  assert(distZero === 0, `Identical coordinates yield 0 km distance`);

  // 2c. TSP Nearest-Neighbor + 2-Opt Optimization
  // 4 points in a line: A(0,0), B(0,1), C(0,2), D(0,3)
  // If given out of order: A, D, B, C -> unoptimized distance: AD (3) + DB (2) + BC (1) = 6 units
  // Optimized distance: AB (1) + BC (1) + CD (1) = 3 units
  const messyLineStops = [
    { dealer_sap_code: 'A', latitude: 20.0, longitude: 85.0, dealer_name: 'Point A' },
    { dealer_sap_code: 'D', latitude: 20.0, longitude: 85.3, dealer_name: 'Point D' },
    { dealer_sap_code: 'B', latitude: 20.0, longitude: 85.1, dealer_name: 'Point B' },
    { dealer_sap_code: 'C', latitude: 20.0, longitude: 85.2, dealer_name: 'Point C' },
  ];
  const tspRes = optimizeDayRoute(messyLineStops);
  const tspOrder = tspRes.orderedVisits.map(s => s.dealer_sap_code).join(' -> ');
  console.log('  TSP ordered route:', tspOrder, `Total distance: ${tspRes.totalDistanceKm} km`);
  assert(
    tspOrder === 'A -> B -> C -> D' || tspOrder === 'D -> C -> B -> A',
    `2-Opt TSP straightened criss-cross path into monotonic sequence (${tspOrder})`
  );
  assert(tspRes.polyline.length === 4, `Polyline contains all 4 waypoints`);
  assert(tspRes.orderedVisits[0].distance_from_prev_km === 0, `First stop has distance_from_prev_km = 0`);

  // 2d. Robustness with non-GPS stops
  const mixedStops = [
    { dealer_sap_code: 'G1', latitude: 23.8, longitude: 91.2, route_name: 'AMC' },
    { dealer_sap_code: 'N1', latitude: null, longitude: null, route_name: 'AMC' },
    { dealer_sap_code: 'G2', latitude: 23.9, longitude: 91.3, route_name: 'BAMUTIA' },
    { dealer_sap_code: 'N2', latitude: 0, longitude: 0, route_name: 'BAMUTIA' }
  ];
  const mixedRes = optimizeDayRoute(mixedStops);
  assert(mixedRes.orderedVisits.length === 4, `All 4 mixed stops retained in route`);
  assert(mixedRes.polyline.length === 2, `Polyline only includes valid GPS stops`);

  // -------------------------------------------------------------------------
  // TEST SUITE 3: Capacitated Spatial Clustering
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 3: Capacitated Spatial Clustering ---');
  const workingDays = ['2026-07-01', '2026-07-02', '2026-07-03'];
  const testVisits = [
    // 4 visits in North cluster
    { sap_code: 'N1', latitude: 26.50, longitude: 92.50, route_name: 'NORTH' },
    { sap_code: 'N2', latitude: 26.51, longitude: 92.51, route_name: 'NORTH' },
    { sap_code: 'N3', latitude: 26.52, longitude: 92.52, route_name: 'NORTH' },
    { sap_code: 'N4', latitude: 26.53, longitude: 92.53, route_name: 'NORTH' },
    // 4 visits in South cluster
    { sap_code: 'S1', latitude: 23.50, longitude: 91.50, route_name: 'SOUTH' },
    { sap_code: 'S2', latitude: 23.51, longitude: 91.51, route_name: 'SOUTH' },
    { sap_code: 'S3', latitude: 23.52, longitude: 91.52, route_name: 'SOUTH' },
    { sap_code: 'S4', latitude: 23.53, longitude: 91.53, route_name: 'SOUTH' },
  ];
  const { dayAllocations, dayRouteMaps, unallocated } = clusterAndScheduleHeuristicRoutes(testVisits, workingDays, 4);
  assert(unallocated.length === 0, `All 8 test visits allocated (unallocated = 0)`);
  assert(dayAllocations.size === 3, `dayAllocations Map initialized for 3 working days`);

  let daysWithVisits = 0;
  for (const [date, visits] of dayAllocations.entries()) {
    if (visits.length > 0) {
      daysWithVisits++;
      assert(visits.length <= 4, `Day ${date} adheres to capacity cap <= 4 (has ${visits.length})`);
      const rMap = dayRouteMaps.get(date);
      console.log(`    Day ${date}: ${visits.length} visits (~${rMap?.totalDistanceKm || 0} km) -> ${visits.map(v => v.route_name).join(', ')}`);
      // Assert homogeneous clustering (no mixing of NORTH and SOUTH on the same day)
      const routes = new Set(visits.map(v => v.route_name));
      assert(routes.size === 1, `Day ${date} exclusively contains visits from one cluster (${[...routes][0]})`);
    }
  }
  assert(daysWithVisits >= 2, `8 visits allocated across working days adhering to clustering constraints`);

  // -------------------------------------------------------------------------
  // TEST SUITE 4: End-to-End Plan Generation & Database Persistence
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 4: End-to-End Plan Generation with Heuristic Routing ---');
  let testSo = await dbGet(`
    SELECT emp_code, emp_name, designation 
    FROM master_employees 
    WHERE emp_code = '1101046'
    LIMIT 1
  `);
  if (!testSo) {
    testSo = await dbGet(`
      SELECT emp_code, emp_name, designation 
      FROM master_employees 
      WHERE (designation LIKE '%SO%' OR designation LIKE '%OFFICER%')
        AND emp_code IS NOT NULL AND emp_code != ''
      LIMIT 1
    `);
  }
  assert(testSo != null, `Found test Sales Officer: ${testSo?.emp_name} (${testSo?.emp_code})`);

  const generator = new AutoPlanGenerator();
  const planResult = await generator.generatePlan(
    testSo.emp_code,
    '2026-07',
    'SO',
    'C1',
    { createdBy: 'COMPREHENSIVE_TEST_RUN' }
  );

  assert(planResult.success === true, `AutoPlanGenerator returned success: true`);
  assert(planResult.planId > 0, `Generated Plan ID is ${planResult.planId}`);
  assert(planResult.totalVisitsScheduled > 0, `Total visits scheduled: ${planResult.totalVisitsScheduled}`);
  assert(planResult.totalDistanceKm > 0, `Calculated total plan route distance: ${planResult.totalDistanceKm} km`);
  console.log(`  Plan Result Message: "${planResult.message}"`);

  // Verify DB sales_plan_details columns populated
  const dbVisits = await dbAll(
    `SELECT id, plan_id, visit_date, sequence, dealer_sap_code, dealer_name, 
            latitude, longitude, distance_from_prev_km, route_name 
     FROM sales_plan_details 
     WHERE plan_id = ? 
     ORDER BY visit_date ASC, sequence ASC`,
    [planResult.planId]
  );
  assert(dbVisits.length === planResult.totalVisitsScheduled, `Database row count (${dbVisits.length}) matches scheduled visits count`);
  
  const visitsWithCoords = dbVisits.filter(v => v.latitude && v.longitude && v.latitude !== 0);
  console.log(`  Visits with GPS in DB: ${visitsWithCoords.length} / ${dbVisits.length}`);
  assert(visitsWithCoords.length > 0, `Visits have persisted latitude and longitude`);
  
  const visitsWithRoute = dbVisits.filter(v => v.route_name && v.route_name.trim() !== '');
  assert(visitsWithRoute.length > 0, `Visits have persisted SFA route_name`);

  // -------------------------------------------------------------------------
  // TEST SUITE 5: Route Map API Endpoint Validation
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 5: Route Map API Controller & Schema Validation ---');
  let apiResponse = null;
  const mockReq = { params: { planId: planResult.planId } };
  const mockRes = {
    status: (code) => ({
      json: (data) => {
        console.error(`Route Map API returned HTTP error ${code}:`, data);
        apiResponse = { status: code, data };
        return data;
      }
    }),
    json: (data) => {
      apiResponse = { status: 200, data };
      return data;
    }
  };

  await getPlanRouteMap(mockReq, mockRes);
  assert(apiResponse?.status === 200, `getPlanRouteMap returned HTTP 200`);
  const rData = apiResponse.data;
  assert(rData.success === true, `API response success === true`);
  assert(rData.planId === planResult.planId, `API response planId matches generated plan`);
  assert(rData.days && rData.days.length > 0, `API response contains ${rData.days.length} days`);
  assert(typeof rData.totalDistanceKm === 'number', `API response has valid numeric totalDistanceKm`);

  // Verify daily structure and monotonic cumulative distance
  let cumulativeCheckPassed = true;
  for (const day of rData.days) {
    assert(day.visitDate && day.visitCount > 0, `Day ${day.visitDate} has visitCount = ${day.visitCount}`);
    assert(Array.isArray(day.polyline), `Day ${day.visitDate} has polyline array`);
    assert(Array.isArray(day.stops), `Day ${day.visitDate} has stops array`);

    let runningDistance = 0;
    for (let i = 0; i < day.stops.length; i++) {
      const stop = day.stops[i];
      assert(stop.sequence === i + 1, `Stop sequence matches index (${stop.sequence} == ${i + 1})`);
      runningDistance += (stop.distanceFromPrevKm || 0);
      const diff = Math.abs(runningDistance - (stop.cumulativeDistanceKm || 0));
      if (diff > 0.05) cumulativeCheckPassed = false;
    }
  }
  assert(cumulativeCheckPassed, `Cumulative distances across all stops accumulate monotonically`);

  // -------------------------------------------------------------------------
  // TEST SUITE 6: Interactive Resequencing on Visit Move & Delete
  // -------------------------------------------------------------------------
  console.log('\n--- Test Suite 6: Interactive Route Resequencing (Move & Delete) ---');
  // Find a day with >= 2 visits
  const targetDay = rData.days.find(d => d.visitCount >= 2);
  assert(targetDay != null, `Found day with multiple visits: ${targetDay?.visitDate} (${targetDay?.visitCount} visits)`);

  const visitToMove = targetDay.stops[0];
  const targetOtherDay = rData.days.find(d => d.visitDate !== targetDay.visitDate && d.visitCount < 8);
  assert(targetOtherDay != null, `Found alternative target day with available capacity: ${targetOtherDay?.visitDate} (${targetOtherDay?.visitCount}/8 visits)`);

  console.log(`  Moving visit #${visitToMove.detailId} (${visitToMove.dealerName}) from ${targetDay.visitDate} to ${targetOtherDay.visitDate}...`);

  let moveResData = null;
  const mockMoveReq = {
    params: {
      empCode: testSo.emp_code,
      planId: planResult.planId,
      detailId: visitToMove.detailId
    },
    body: {
      visitDate: targetOtherDay.visitDate,
      purposeOfVisit: 'Moved via Heuristic Test'
    }
  };
  const mockMoveRes = {
    status: (code) => ({
      json: (data) => {
        console.error(`moveVisit returned error ${code}:`, data);
        moveResData = { status: code, data };
        return data;
      }
    }),
    json: (data) => {
      moveResData = { status: 200, data };
      return data;
    }
  };

  await moveVisit(mockMoveReq, mockMoveRes);
  assert(moveResData?.status === 200, `moveVisit succeeded with HTTP 200`);

  // Resequencing assertion: Verify moved visit date in DB
  const updatedVisit = await dbGet(
    'SELECT visit_date, sequence FROM sales_plan_details WHERE id = ?',
    [visitToMove.detailId]
  );
  assert(
    String(updatedVisit.visit_date).slice(0, 10) === targetOtherDay.visitDate,
    `Visit successfully moved to ${targetOtherDay.visitDate}`
  );

  // Re-fetch route map to verify both days resequenced correctly
  let refreshedApi = null;
  await getPlanRouteMap(mockReq, {
    status: () => ({ json: (d) => { refreshedApi = d; } }),
    json: (d) => { refreshedApi = d; }
  });
  const refreshedOriginDay = refreshedApi.days.find(d => d.visitDate === targetDay.visitDate);
  const refreshedDestDay = refreshedApi.days.find(d => d.visitDate === targetOtherDay.visitDate);

  assert(
    refreshedOriginDay.visitCount === targetDay.visitCount - 1,
    `Origin day count decreased by 1 (${targetDay.visitCount} -> ${refreshedOriginDay.visitCount})`
  );
  assert(
    refreshedDestDay.visitCount === targetOtherDay.visitCount + 1,
    `Destination day count increased by 1 (${targetOtherDay.visitCount} -> ${refreshedDestDay.visitCount})`
  );

  // Sequences on both days must start at 1 and be contiguous
  refreshedOriginDay.stops.forEach((s, idx) => {
    assert(s.sequence === idx + 1, `Origin day stop sequence correctly renumbered to ${s.sequence}`);
  });
  refreshedDestDay.stops.forEach((s, idx) => {
    assert(s.sequence === idx + 1, `Destination day stop sequence correctly renumbered to ${s.sequence}`);
  });

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`  HEURISTIC ROUTE TEST SUITE COMPLETE: ${passedTests} / ${totalTests} ASSERTIONS PASSED (100%)`);
  console.log('===============================================================\n');

  process.exit(0);
}

runComprehensiveTests().catch(err => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
