import type { DashboardData, DutyRequest, Permissions } from "./types";

// In-memory seed for local prototyping only. Replace this adapter with a database
// before deployment; serverless instances do not provide durable shared state.
const state: DashboardData = {
  permissions: {
    hr_add_employee: true,
    hr_geotag_monitor: true,
    hr_od_approvals: true,
    hr_monthly_download: true,
  },
  office: { name: "Main Office", lat: 17.4435, lng: 78.3772, allowedRadiusMeters: 250 },
  attendance: [],
  requests: [],
  employees: [],
};

export function getDashboard(): DashboardData {
  return structuredClone(state);
}

export function updatePermissions(permissions: Permissions) {
  state.permissions = permissions;
}

export function updateOffice(office: DashboardData["office"]) {
  if (!office.name.trim() || !Number.isFinite(office.lat) || office.lat < -90 || office.lat > 90 || !Number.isFinite(office.lng) || office.lng < -180 || office.lng > 180 || !Number.isFinite(office.allowedRadiusMeters) || office.allowedRadiusMeters <= 0) {
    throw new Error("Enter a valid office name, latitude, longitude, and geofence radius.");
  }
  if (office.accuracyMeters !== undefined && (!Number.isFinite(office.accuracyMeters) || office.accuracyMeters > 50)) {
    throw new Error("The captured office location is too imprecise. Get a fix with 50 m accuracy or better.");
  }
  state.office = office;
}

export function addEmployee(employee: DashboardData["employees"][number]) {
  if (state.employees.some((item) => item.id === employee.id)) throw new Error("Employee ID already exists");
  state.employees.push(employee);
}

export function addAttendance(record: DashboardData["attendance"][number]) {
  if (record.mode === "IN_OFFICE_GEOTAG") {
    const { latitude, longitude, accuracyMeters } = record;
    if (![latitude, longitude, accuracyMeters].every(Number.isFinite) || !accuracyMeters || accuracyMeters > 50) {
      throw new Error("Location accuracy is insufficient. Try again with a clear GPS fix (50 m accuracy or better required).");
    }
    const toRad = (degrees: number) => degrees * Math.PI / 180;
    const dLat = toRad(state.office.lat - latitude!);
    const dLng = toRad(state.office.lng - longitude!);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(latitude!)) * Math.cos(toRad(state.office.lat)) * Math.sin(dLng / 2) ** 2;
    const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (distance + accuracyMeters > state.office.allowedRadiusMeters) {
      throw new Error("Your location is outside the office geofence, considering the GPS accuracy margin.");
    }
  }
  if (state.attendance.some((item) => item.employeeId === record.employeeId && item.occurredAt.slice(0, 10) === record.occurredAt.slice(0, 10))) {
    throw new Error("Attendance is already marked for today");
  }
  state.attendance.unshift(record);
}

export function addRequest(request: DutyRequest) {
  state.requests.unshift(request);
}

export function decideRequest(id: string, status: "APPROVED" | "REJECTED") {
  const request = state.requests.find((item) => item.id === id);
  if (!request || request.status !== "PENDING") throw new Error("Request is missing or already decided");
  request.status = status;
  if (status === "APPROVED") {
    state.attendance.unshift({
      id: crypto.randomUUID(), employeeId: request.employeeId, employeeName: request.employeeName,
      occurredAt: new Date().toISOString(), mode: "ON_DUTY_OUT_OF_GEOTAG",
      locationLabel: `${request.locationName} (approved on-duty)`,
    });
  }
}
