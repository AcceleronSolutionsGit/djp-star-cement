# Unplanned Visits API Documentation

**Author / System:** DJP Platform Engine & SFA Reconciliation Pipeline  
**Target Audience:** Mobile App Developers (React Native / Flutter / Native Android / iOS) & Admin Portal Integrators  
**Date:** 11-Oct-2026  
**Status:** Active & Verified Production Build  

---

## 1. Executive Summary & Architecture

In the Star Cement DJP (Daily Journey Plan) system:
* **Planned Visits:** Visits made by an officer to dealers scheduled in their monthly Permanent Journey Plan (`sales_plan_details`) or assigned within their monthly target counter list (`dealer_visit_targets`).
* **Unplanned Visits:** Visits recorded in SFA where an officer visited a dealer, retailer, or counter that was **not** on their scheduled plan for that day or period.

During SFA sync (`POST /api/sfa/sync`) or file ingestion (`POST /api/uploads/process`), the **Unplanned Reconciliation Engine** cross-checks every visit log against the officer's plan and flags unexpected visits with:
* `is_unplanned = 1`
* `reason = "Dealer not on officer's plan"`

Two dedicated APIs are provided:
1. **Field App API:** Scoped to the individual officer (`:empCode`), with mandatory **T-1 day cutoff** enforcement.
2. **Admin & Web Portal API:** Global endpoint allowing multi-officer, multi-branch querying, filtering, and pagination.

---

## 2. The T-1 Day Cutoff Rule

> [!IMPORTANT]
> **Why T-1 Day?**
> Sales operations field teams log visits continuously throughout the day. Because current-day (T) logs remain incomplete until midnight sync, exposing today's incomplete records would artificially skew adherence and show partial counts.
> 
> Therefore, all SFA sync jobs, report downloads, and mobile unplanned queries strictly filter data up to **yesterday ($T - 1$)**:
> $$\text{Cutoff Date} = \text{Date}(\text{Today} - 1\text{ day})$$

---

## 3. API 1: Mobile Field App (Officer-Scoped)

### Endpoint Overview
* **Method:** `GET`
* **Path:** `/api/app/officers/:empCode/unplanned-visits`
* **Authentication:** App Session / Bearer Token
* **Scope:** Scoped exclusively to the officer identified by `:empCode`.

### Path Parameters
| Parameter | Type | Required | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `empCode` | String | **Yes** | Officer's Employee ID | `SO_KOL_01`, `EMP1024` |

### Query Parameters
| Parameter | Type | Required | Default | Description | Example |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `month` | String | No | *Current Month* | Month in `YYYY-MM` format | `2026-10` |
| `startDate` | String | No | *None* | Range start (`YYYY-MM-DD`) | `2026-10-01` |
| `endDate` | String | No | *T-1 Day* | Range end. Clamped to yesterday automatically if omitted or if a future date is supplied. | `2026-10-10` |
| `search` | String | No | *None* | Text search across Customer Name, SFA Code, Route, or Branch/Area | `Gupta` |
| `limit` | Integer| No | `100` | Page size | `20` |
| `offset` | Integer| No | `0` | Offset for pagination | `0` |

### Request Headers
```http
GET /api/app/officers/SO_KOL_01/unplanned-visits?month=2026-10 HTTP/1.1
Host: api.yourdomain.com
Authorization: Bearer <TOKEN>
Accept: application/json
```

### Success Response (`200 OK`)
```json
{
  "success": true,
  "emp_code": "SO_KOL_01",
  "synced_till": "2026-10-10",
  "total": 2,
  "unplanned_visits": [
    {
      "id": 14205,
      "visit_date": "2026-10-09",
      "customer_code": "WBM273",
      "mapped_sap_code": "1002345",
      "customer_name": "M/S GUPTA HARDWARE & CEMENT",
      "customer_type": "DEALER",
      "route": "Barasat Main Market",
      "branch": "Kolkata North",
      "employee_code": "SO_KOL_01",
      "employee_name": "Rajesh Sharma",
      "check_in_time": "11:32 AM",
      "check_out_time": "11:58 AM",
      "duration": "26 mins",
      "visit_status": "COMPLETED",
      "purpose_of_visit": "Market Demand Assessment",
      "remarks": "Visited on urgent request of distributor.",
      "is_unplanned": 1,
      "reason": "Dealer not on officer's plan"
    },
    {
      "id": 14218,
      "visit_date": "2026-10-08",
      "customer_code": "SDNE109",
      "mapped_sap_code": "1008761",
      "customer_name": "MAA TARA ENTERPRISE",
      "customer_type": "SUB-DEALER",
      "route": "Habra Bypass",
      "branch": "Kolkata North",
      "employee_code": "SO_KOL_01",
      "employee_name": "Rajesh Sharma",
      "check_in_time": "02:15 PM",
      "check_out_time": "02:40 PM",
      "duration": "25 mins",
      "visit_status": "COMPLETED",
      "purpose_of_visit": "Stock Verification",
      "remarks": "Ad-hoc counter check.",
      "is_unplanned": 1,
      "reason": "Dealer not on officer's plan"
    }
  ]
}
```

---

## 4. API 2: Admin & Web Portal (Global / All Officers)

### Endpoint Overview
* **Method:** `GET`
* **Path:** `/api/sfa/unplanned-visits`
* **Authentication:** Admin Session / Bearer Token
* **Scope:** Global. Supports querying across all officers, roles, areas, and branches.

### Query Parameters
| Parameter | Type | Required | Default | Description | Example |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `periodMonth` | String | No | *None* | Plan period month (`YYYY-MM`) | `2026-10` |
| `employeeCode`| String | No | `ALL` | Specific officer employee code or `ALL` | `SO_KOL_01` |
| `startDate` | String | No | *None* | Earliest visit date (`YYYY-MM-DD`) | `2026-10-01` |
| `endDate` | String | No | *None* | Latest visit date (`YYYY-MM-DD`) | `2026-10-10` |
| `search` | String | No | *None* | Search in Customer Name, Customer Code, Officer Name, Officer Code, or Branch | `North` |
| `limit` | Integer| No | `100` | Number of items per page | `15` |
| `offset` | Integer| No | `0` | Offset for pagination | `0` |

### Success Response (`200 OK`)
```json
{
  "total": 45,
  "visits": [
    {
      "id": 14205,
      "visit_date": "2026-10-09",
      "customer_code": "WBM273",
      "mapped_sap_code": "1002345",
      "customer_name": "M/S GUPTA HARDWARE & CEMENT",
      "customer_type": "DEALER",
      "route": "Barasat Main Market",
      "branch": "Kolkata North",
      "employee_code": "SO_KOL_01",
      "employee_name": "Rajesh Sharma",
      "check_in_time": "11:32 AM",
      "check_out_time": "11:58 AM",
      "duration": "26 mins",
      "visit_status": "COMPLETED",
      "purpose_of_visit": "Market Demand Assessment",
      "remarks": "Visited on urgent request of distributor.",
      "is_unplanned": 1,
      "reason": "Dealer not on officer's plan"
    }
  ]
}
```

---

## 5. Field Dictionary

| Field | Type | Example | Description |
| :--- | :--- | :--- | :--- |
| `id` | Integer | `14205` | Unique ID of the execution log record in `visit_execution_logs` |
| `visit_date` | String | `2026-10-09` | Date on which the field visit took place (`YYYY-MM-DD`) |
| `customer_code` | String | `WBM273` | SFA Dealer / Counter Code logged by mobile SFA |
| `mapped_sap_code` | String / null | `1002345` | SAP ERP account number resolved from `master_dealers` |
| `customer_name` | String | `M/S GUPTA HARDWARE` | Registered dealer / firm name |
| `customer_type` | String | `DEALER` | Business entity type (`DEALER`, `SUB-DEALER`, `PROSPECT`) |
| `route` | String | `Barasat Main Market` | Beat / Route name |
| `branch` | String | `Kolkata North` | Operational Area / Branch (merged entity) |
| `employee_code` | String | `SO_KOL_01` | Officer Employee ID |
| `employee_name` | String | `Rajesh Sharma` | Officer Name |
| `check_in_time` | String | `11:32 AM` | Timestamp or formatted time when officer checked in |
| `check_out_time` | String | `11:58 AM` | Timestamp or formatted time when officer checked out |
| `duration` | String | `26 mins` | Duration spent at counter |
| `visit_status` | String | `COMPLETED` | Execution state (`COMPLETED`, `VISITED`, `CANCELLED`) |
| `purpose_of_visit`| String | `Market Demand` | Visit category recorded in SFA |
| `remarks` | String | `Ad-hoc visit` | Remarks typed by officer in the field |
| `is_unplanned` | Integer | `1` | `1` indicates visit was not on the officer's scheduled plan |
| `reason` | String | `Dealer not on plan`| Explanatory label generated by reconciliation engine |

---

## 6. Client Code Integration Examples

### React Native / Mobile JavaScript

```javascript
/**
 * Fetches unplanned visits for the logged-in field officer
 * @param {string} empCode - Logged-in employee code (e.g. 'SO_KOL_01')
 * @param {string} month - Current period month ('YYYY-MM')
 */
export async function getOfficerUnplannedVisits(empCode, month = '2026-10') {
  try {
    const url = `https://api.yourdomain.com/api/app/officers/${encodeURIComponent(empCode)}/unplanned-visits?month=${month}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: Failed to fetch unplanned visits`);
    }

    const data = await response.json();
    // data.synced_till -> Cutoff date e.g. "2026-10-10"
    // data.unplanned_visits -> Array of unplanned visit objects
    return {
      syncedTill: data.synced_till,
      total: data.total,
      visits: data.unplanned_visits || []
    };
  } catch (error) {
    console.error('[UNPLANNED_VISITS] Error:', error.message);
    return { syncedTill: null, total: 0, visits: [] };
  }
}
```

### Flutter (Dart)

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

Future<Map<String, dynamic>> fetchUnplannedVisits(String empCode, String month, String token) async {
  final uri = Uri.parse(
    'https://api.yourdomain.com/api/app/officers/$empCode/unplanned-visits?month=$month'
  );

  final response = await http.get(uri, headers: {
    'Authorization': 'Bearer $token',
    'Accept': 'application/json',
  });

  if (response.statusCode == 200) {
    final Map<String, dynamic> body = jsonDecode(response.body);
    return {
      'syncedTill': body['synced_till'],
      'total': body['total'],
      'visits': body['unplanned_visits'] as List<dynamic>,
    };
  } else {
    throw Exception('Failed to load unplanned visits: ${response.statusCode}');
  }
}
```

### cURL (Admin Endpoint with Pagination)

```bash
curl -X GET "https://api.yourdomain.com/api/sfa/unplanned-visits?periodMonth=2026-10&limit=15&offset=0&search=Barasat" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Accept: application/json"
```

---

## 7. Error Codes & Handling

| Status Code | Reason | Cause | Suggested Client Handling |
| :--- | :--- | :--- | :--- |
| `401 Unauthorized` | Missing / Invalid Token | Session expired | Redirect user to Login |
| `404 Not Found` | Unknown Route / Officer | Officer code has no record | Verify employee code format |
| `500 Server Error` | Database / Engine failure | Server issue | Show retry dialog with fallback |
