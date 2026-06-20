# Expo Go QR — ORA OS

Open the **Expo Go** app on your phone and scan `expo-go-qr.png` (or the QR shown in the terminal where Expo runs).

- **Tunnel URL (Expo Go):** `exp://s9xohte-anonymous-3000.exp.direct`
- **Web preview:** `https://s9xohte-anonymous-3000.exp.direct`
- **Backend (FastAPI) preview URL:** `https://6c0dc32d-86ea-4a74-83b6-05783617ecb7.preview.emergentagent.com`
- **Google OAuth redirect URI (register this in Google Cloud Console):**
  `https://6c0dc32d-86ea-4a74-83b6-05783617ecb7.preview.emergentagent.com/api/google/callback`

The tunnel host (`s9xohte-anonymous-3000.exp.direct`) is regenerated every time `expo start --tunnel` is restarted. If the QR stops working, restart the frontend (`sudo supervisorctl restart frontend`) and regenerate the QR with the new tunnel host.
