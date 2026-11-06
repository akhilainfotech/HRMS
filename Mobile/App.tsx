import { useEffect, useRef, useState } from "react";
import { Alert, Image, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { apiBase, getSupabase } from "./lib/supabase";

type Office = { name: string; lat: number; lng: number; allowedRadiusMeters: number };
type Dashboard = { office: Office | null; todayAttendance: { id: string; occurredAt: string } | null };
type EmployeeProfile = { id: string; name: string; department: string };
type FaceFeedback = { kind: "checking" | "matched" | "mismatch" | "error"; message: string };

function distanceMeters(a: { latitude: number; longitude: number }, b: Office) {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(b.lat - a.latitude), dLng = rad(b.lng - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

export default function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(true);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [faceFeedback, setFaceFeedback] = useState<FaceFeedback | null>(null);
  const cameraRef = useRef<CameraView>(null);

  async function load() {
    try {
      const { data: { session } } = await getSupabase().auth.getSession();
      if (!session) { setProfile(null); return; }
      const response = await fetch(`${apiBase}/api/mobile/dashboard`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load employee profile.");
      setProfile(result.profile); setDashboard({ office: result.office, todayAttendance: result.todayAttendance });
    } catch (error) {
      Alert.alert("Can’t load HRMS", error instanceof Error ? error.message : `Check the API URL: ${apiBase}`);
    } finally { setAuthBusy(false); }
  }
  useEffect(() => {
    void load();
    let subscription: { unsubscribe: () => void } | undefined;
    try { subscription = getSupabase().auth.onAuthStateChange((_event, session) => { if (!session) { setProfile(null); setDashboard(null); } }).data.subscription; } catch { /* Sign-in screen explains missing configuration. */ }
    return () => subscription?.unsubscribe();
  }, []);

  async function signIn() {
    if (!email.trim() || !password) { Alert.alert("Enter your sign-in details", "Use the work email and initial password provided by your HRMS administrator."); return; }
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      const { data: { session } } = await getSupabase().auth.getSession();
      const response = await fetch(`${apiBase}/api/mobile/dashboard`, { headers: { Authorization: `Bearer ${session?.access_token}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) { await getSupabase().auth.signOut(); throw new Error(result.error ?? "This account cannot use the employee app."); }
      setProfile(result.profile); setDashboard({ office: result.office, todayAttendance: result.todayAttendance }); setPassword("");
    } catch (error) { Alert.alert("Sign-in failed", error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); setAuthBusy(false); }
  }

  async function signOut() {
    try { await getSupabase().auth.signOut(); } catch { /* Clear local app state regardless. */ }
    setProfile(null); setDashboard(null); setSelfieUri(null); setLocation(null);
  }

  async function reloadAttendance() {
    const { data: { session } } = await getSupabase().auth.getSession();
    if (!session) return;
    const response = await fetch(`${apiBase}/api/mobile/dashboard`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
    const result = await response.json();
    if (response.ok) { setProfile(result.profile); setDashboard({ office: result.office, todayAttendance: result.todayAttendance }); }
  }

  async function startFaceScan() {
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
    if (!permission.granted) { Alert.alert("Camera permission needed", "Allow camera access to take the attendance selfie."); return; }
    setCameraReady(false);
    setCameraOpen(true);
  }

  async function captureSelfie() {
    if (!cameraReady || !cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
      if (!photo?.uri) throw new Error("Camera did not return a photo.");
      setFaceFeedback(null);
      setSelfieUri(photo.uri);
      setCameraOpen(false);
    } catch (error) { Alert.alert("Could not take selfie", error instanceof Error ? error.message : "Please try again."); }
  }

  async function locate() {
    setBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error("Location permission is required to check the office geofence.");
      setLocation(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
    } catch (error) { Alert.alert("Location unavailable", error instanceof Error ? error.message : "Try again."); }
    finally { setBusy(false); }
  }

  async function markAttendance() {
    if (!profile || !dashboard?.office || !selfieUri || !insideGeofence || !location) return;
    setBusy(true);
    setFaceFeedback({ kind: "checking", message: "Checking this selfie against your enrolled face…" });
    try {
      const { data: { session } } = await getSupabase().auth.getSession();
      if (!session) throw new Error("Your session expired. Sign in again.");
      const body = new FormData();
      body.append("latitude", String(location.coords.latitude)); body.append("longitude", String(location.coords.longitude)); body.append("accuracyMeters", String(gpsAccuracy));
      body.append("photo", { uri: selfieUri, type: "image/jpeg", name: "attendance-selfie.jpg" } as unknown as Blob);
      const response = await fetch(`${apiBase}/api/attendance`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body });
      const result = await response.json();
      if (!response.ok) {
        const message = result.faceMatch?.matched === false
          ? "Face not matched. Retake the selfie in good light, center your face, and try again."
          : response.status === 422
            ? "Face scan was unclear. Retake the selfie with one face centered in good light."
            : result.error ?? "Could not mark attendance. Check your GPS and try again.";
        setFaceFeedback({ kind: result.faceMatch?.matched === false || response.status === 422 ? "mismatch" : "error", message });
        return;
      }
      await reloadAttendance();
      setSelfieUri(null);
      setFaceFeedback({ kind: "matched", message: "Face matched. Attendance marked successfully." });
    } catch (error) {
      setFaceFeedback({ kind: "error", message: error instanceof Error ? error.message : "Could not mark attendance. Please try again." });
    }
    finally { setBusy(false); }
  }

  const officeDistance = location && dashboard?.office ? distanceMeters(location.coords, dashboard.office) : null;
  const gpsAccuracy = location?.coords.accuracy ?? null;
  const accuracyMargin = gpsAccuracy ?? Infinity;
  const accurateFix = accuracyMargin <= 50;
  const insideGeofence = officeDistance !== null && accurateFix && officeDistance + accuracyMargin <= (dashboard?.office?.allowedRadiusMeters ?? 0);
  const geofenceStatus = officeDistance === null ? "LOCATION NOT CHECKED" : !accurateFix ? "GPS FIX TOO IMPRECISE" : insideGeofence ? "IN-OFFICE GEOTAG VERIFIED" : "OUTSIDE OFFICE GEOFENCE";
  const alreadyMarked = !!dashboard?.todayAttendance;

  if (!profile) return <SafeAreaView style={styles.safe}><StatusBar style="light"/><View style={styles.loginPage}>
    <View style={styles.logo}><Text style={styles.logoText}>AR</Text></View><Text style={styles.kicker}>EMPLOYEE MOBILE APP</Text><Text style={styles.loginTitle}>Sign in</Text><Text style={styles.loginCopy}>Use your work account to continue to attendance.</Text>
    <View style={styles.loginForm}><TextInput style={styles.input} placeholder="Work email" placeholderTextColor="#7f8ba2" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail}/><TextInput style={styles.input} placeholder="Password" placeholderTextColor="#7f8ba2" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword}/><TouchableOpacity style={styles.primary} onPress={() => void signIn()} disabled={busy || authBusy}><Text style={styles.primaryText}>{busy || authBusy ? "Please wait…" : "Sign in to attendance"}</Text></TouchableOpacity></View>
    <Text style={styles.loginFootnote}>Your employee ID, name, and department come from your HRMS account.</Text>
  </View></SafeAreaView>;

  const checkinReady = !!selfieUri && insideGeofence && !alreadyMarked && !busy && !!dashboard;
  return <SafeAreaView style={styles.safe}><StatusBar style="light"/><ScrollView contentContainerStyle={styles.page}>
    <View style={styles.header}><View style={styles.avatar}><Text style={styles.avatarText}>{profile.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</Text></View><View style={styles.profile}><Text style={styles.kicker}>EMPLOYEE MOBILE APP</Text><Text style={styles.name}>{profile.name}</Text><Text style={styles.meta}>{profile.id} · {profile.department}</Text></View><TouchableOpacity onPress={() => void signOut()}><Text style={styles.signOut}>Sign out</Text></TouchableOpacity></View>
    <View style={[styles.geofence, insideGeofence ? styles.geoInside : styles.geoUnknown]}><View style={styles.geoTop}><Text style={styles.geoTitle}>{geofenceStatus}</Text>{officeDistance !== null && <Text style={styles.geoDistance}>{officeDistance}m</Text>}</View><Text style={styles.geoCoords}>{location ? `Lat ${location.coords.latitude.toFixed(4)}°, Lng ${location.coords.longitude.toFixed(4)}° · ±${gpsAccuracy ?? "?"}m accuracy` : "Check your GPS location to verify the office geofence."}</Text><Text style={styles.geoOffice}>{dashboard?.office?.name ?? (dashboard ? "Office location is not configured" : "Loading office settings…")}{dashboard?.office ? ` · ${dashboard.office.allowedRadiusMeters}m radius` : ""}</Text><TouchableOpacity style={styles.locationButton} onPress={() => void locate()} disabled={busy}><Text style={styles.locationButtonText}>{busy ? "Checking GPS…" : "Refresh GPS"}</Text></TouchableOpacity></View>
    <View style={styles.card}><Text style={styles.stepTitle}>STEP 1: FACE VERIFICATION</Text><View style={styles.scanBox}>{selfieUri ? <Image source={{ uri: selfieUri }} style={styles.preview}/>:<View style={styles.faceIcon}><Text style={styles.faceIconText}>◉</Text></View>}<Text style={styles.scanPrompt}>{selfieUri ? "Selfie ready for verification" : "Scan your face for attendance"}</Text><Text style={styles.scanNote}>Compared securely with the photo enrolled for your employee ID.</Text></View>{faceFeedback && <View style={[styles.faceFeedback, faceFeedback.kind === "matched" ? styles.faceFeedbackSuccess : faceFeedback.kind === "mismatch" ? styles.faceFeedbackMismatch : faceFeedback.kind === "checking" ? styles.faceFeedbackChecking : styles.faceFeedbackError]}><Text style={styles.faceFeedbackText}>{faceFeedback.message}</Text></View>}<TouchableOpacity style={styles.scanButton} onPress={() => void startFaceScan()} disabled={busy}><Text style={styles.scanButtonText}>{selfieUri ? "Retake selfie" : "◎   Scan face"}</Text></TouchableOpacity></View>
    <View style={styles.card}><Text style={styles.stepTitleGreen}>STEP 2: IN-OFFICE GEOTAG ATTENDANCE</Text><Text style={styles.instruction}>{officeDistance === null ? "Check your location above, then capture a selfie to enable attendance." : insideGeofence ? `You are inside the office geofence (${officeDistance}m). Capture a selfie and tap below to mark today’s attendance.` : `You are outside the office geofence (${officeDistance}m). In-office check-in is unavailable.`}</Text><TouchableOpacity style={checkinReady ? styles.markButton : styles.disabledButton} disabled={!checkinReady} onPress={() => void markAttendance()}><Text style={checkinReady ? styles.markText : styles.disabledText}>{alreadyMarked ? "✓  Already Marked Present Today" : "✓  Mark In-Office Attendance (Present)"}</Text></TouchableOpacity></View>
    <Text style={styles.footer}>Your selfie is securely sent for employee ID face matching. Liveness checks are not enabled in this version.</Text>
  </ScrollView>
    <Modal visible={cameraOpen} animationType="slide" onRequestClose={() => setCameraOpen(false)}><SafeAreaView style={styles.cameraPage}><View style={styles.cameraHeader}><Text style={styles.cameraTitle}>Face scan</Text><TouchableOpacity onPress={() => setCameraOpen(false)}><Text style={styles.close}>Cancel</Text></TouchableOpacity></View><View style={styles.cameraFrame}><CameraView ref={cameraRef} style={styles.camera} facing="front" onCameraReady={() => setCameraReady(true)}/><View pointerEvents="none" style={styles.faceGuide}/></View><Text style={styles.cameraHint}>Center your face in the frame, then capture.</Text><TouchableOpacity style={cameraReady ? styles.captureButton : styles.disabledButton} disabled={!cameraReady} onPress={() => void captureSelfie()}><Text style={cameraReady ? styles.scanButtonText : styles.disabledText}>{cameraReady ? "Capture selfie" : "Opening camera…"}</Text></TouchableOpacity></SafeAreaView></Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b1222" }, loginPage: { flex: 1, justifyContent: "center", padding: 26, maxWidth: 520, width: "100%", alignSelf: "center" }, logo: { width: 54, height: 54, borderRadius: 16, backgroundColor: "#4f5bea", alignItems: "center", justifyContent: "center", marginBottom: 24 }, logoText: { color: "white", fontSize: 17, fontWeight: "800" }, kicker: { color: "#22d3ee", fontSize: 11, fontWeight: "700", letterSpacing: 0.7 }, loginTitle: { color: "white", fontSize: 28, fontWeight: "800", marginTop: 8 }, loginCopy: { color: "#9aa9c2", fontSize: 13, marginTop: 7 }, loginForm: { gap: 12, marginTop: 28 }, input: { paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: "#29364d", borderRadius: 11, backgroundColor: "#111b2e", color: "white", fontSize: 14 }, primary: { padding: 14, borderRadius: 10, backgroundColor: "#4f46e5", alignItems: "center", marginTop: 3 }, primaryText: { color: "white", fontSize: 13, fontWeight: "700" }, loginFootnote: { color: "#697890", fontSize: 10, lineHeight: 16, marginTop: 22 },
  page: { padding: 20, gap: 16, maxWidth: 620, width: "100%", alignSelf: "center" }, header: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }, avatar: { width: 46, height: 46, borderRadius: 15, backgroundColor: "#4f5bea", alignItems: "center", justifyContent: "center" }, avatarText: { color: "white", fontWeight: "800", fontSize: 14 }, profile: { flex: 1 }, name: { color: "white", fontWeight: "800", fontSize: 16, marginTop: 3 }, meta: { color: "#a2aec3", fontSize: 10, marginTop: 3 }, signOut: { color: "#91a0b8", fontSize: 10, padding: 7 },
  geofence: { borderRadius: 15, borderWidth: 1, padding: 15, gap: 7 }, geoInside: { borderColor: "#087d65", backgroundColor: "#05241f" }, geoUnknown: { borderColor: "#34415a", backgroundColor: "#101a2b" }, geoTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, geoTitle: { color: "#7ef0c1", fontSize: 11, fontWeight: "800" }, geoDistance: { color: "#7ef0c1", fontSize: 10, fontWeight: "700" }, geoCoords: { color: "#c0d9d1", fontSize: 11 }, geoOffice: { color: "#9db7ae", fontSize: 10 }, locationButton: { alignSelf: "flex-start", paddingVertical: 5 }, locationButtonText: { color: "#22d3ee", fontSize: 10, fontWeight: "700" },
  card: { backgroundColor: "#111b2e", borderColor: "#26334a", borderWidth: 1, borderRadius: 16, padding: 16, gap: 13 }, stepTitle: { color: "#f1f5fb", fontSize: 12, fontWeight: "800" }, stepTitleGreen: { color: "#5ce2ae", fontSize: 12, fontWeight: "800" }, scanBox: { minHeight: 200, backgroundColor: "#030817", borderColor: "#27344d", borderWidth: 1, borderRadius: 15, alignItems: "center", justifyContent: "center", gap: 10, padding: 14 }, faceIcon: { width: 68, height: 68, borderRadius: 34, borderColor: "#3a4c66", borderWidth: 2, backgroundColor: "#101a2b", alignItems: "center", justifyContent: "center" }, faceIconText: { color: "#98a8be", fontSize: 27 }, preview: { width: 100, height: 100, borderRadius: 50, borderColor: "#6a7aff", borderWidth: 2 }, scanPrompt: { color: "white", fontSize: 12, fontWeight: "700", textAlign: "center" }, scanNote: { color: "#8998b0", fontSize: 9, textAlign: "center" }, faceFeedback: { borderWidth: 1, borderRadius: 10, padding: 11 }, faceFeedbackSuccess: { borderColor: "#087d65", backgroundColor: "#05241f" }, faceFeedbackMismatch: { borderColor: "#a33c45", backgroundColor: "#351a24" }, faceFeedbackChecking: { borderColor: "#5662bd", backgroundColor: "#1a2040" }, faceFeedbackError: { borderColor: "#6e5260", backgroundColor: "#2b202b" }, faceFeedbackText: { color: "#f1f5fb", fontSize: 11, lineHeight: 16, textAlign: "center", fontWeight: "700" }, scanButton: { backgroundColor: "#5148e8", borderRadius: 11, alignItems: "center", padding: 14 }, scanButtonText: { color: "white", fontSize: 12, fontWeight: "800" }, instruction: { color: "#aab7ca", fontSize: 11, lineHeight: 18 }, markButton: { backgroundColor: "#0dbb85", borderRadius: 11, alignItems: "center", padding: 14 }, markText: { color: "#032b20", fontWeight: "800", fontSize: 12 }, disabledButton: { backgroundColor: "#303b4e", borderRadius: 11, alignItems: "center", padding: 14 }, disabledText: { color: "#9aa7ba", fontWeight: "700", fontSize: 11 }, footer: { color: "#77869d", fontSize: 9, textAlign: "center", lineHeight: 14, paddingBottom: 15 },
  cameraPage: { flex: 1, backgroundColor: "#0b1222", padding: 18, gap: 16 }, cameraHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, cameraTitle: { color: "white", fontSize: 17, fontWeight: "700" }, close: { color: "#c9d3ff", fontSize: 13, padding: 8 }, cameraFrame: { flex: 1, minHeight: 360, borderRadius: 18, overflow: "hidden", alignItems: "center", justifyContent: "center" }, camera: { ...StyleSheet.absoluteFill }, faceGuide: { width: 230, height: 300, borderWidth: 2, borderColor: "#ffffffbb", borderRadius: 120 }, cameraHint: { color: "#d2d8e5", fontSize: 12, textAlign: "center" }, captureButton: { padding: 15, borderRadius: 9, backgroundColor: "#5148e8", alignItems: "center", marginBottom: 12 },
});

