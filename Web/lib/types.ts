export type Role = "ADMIN" | "HR" | "EMPLOYEE";

export type Permissions = {
  hr_add_employee: boolean;
  hr_geotag_monitor: boolean;
  hr_od_approvals: boolean;
  hr_monthly_download: boolean;
};

export type OfficeGeotag = {
  name: string;
  lat: number;
  lng: number;
  allowedRadiusMeters: number;
  accuracyMeters?: number;
  capturedAt?: string;
};

export type AttendanceRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  occurredAt: string;
  mode: "IN_OFFICE_GEOTAG" | "ON_DUTY_OUT_OF_GEOTAG";
  locationLabel: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
};

export type DutyRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  locationName: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
};

export type Employee = { id: string; name: string; department: string; designation: string; email?: string; faceEnrolled?: boolean };

export type DashboardData = {
  permissions: Permissions;
  office: OfficeGeotag;
  attendance: AttendanceRecord[];
  requests: DutyRequest[];
  employees: Employee[];
};
