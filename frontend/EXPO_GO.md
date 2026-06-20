# Expo Go QR — ORA OS

Open the **Expo Go** app on your phone and scan `expo-go-qr.png` (or the QR shown in the terminal where Expo runs).

- **Tunnel URL (Expo Go):** `exp://txkle7a-anonymous-3000.exp.direct`
- **Web preview:** `https://txkle7a-anonymous-3000.exp.direct`
- **Backend (FastAPI) preview URL:** `https://83106ebd-c21f-4061-a350-cff01f36355d.preview.emergentagent.com`
- **Google OAuth redirect URI (register this in Google Cloud Console):**
  `https://83106ebd-c21f-4061-a350-cff01f36355d.preview.emergentagent.com/api/google/callback`

The tunnel host (`txkle7a-anonymous-3000.exp.direct`) is regenerated every time `expo start --tunnel` is restarted. If the QR stops working, restart the frontend (`sudo supervisorctl restart frontend`) and regenerate the QR with the new tunnel host.
