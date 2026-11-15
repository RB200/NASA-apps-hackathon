# NASA Hackathon 2026: Lunar Analog Finder

Find Earth locations that match potential Artemis III lunar south-pole base sites.

## Try the de Gerlache scenario

Start the app using the quick start below, then select **Try the de Gerlache scenario** on the opening screen. The app selects de Gerlache Rim 2 and searches for Earth terrain, prioritizing steepest areas followed by roughness. Choose a result to compare measurements or open the rover terrain viewer.

With the app running, open [the demo directly](http://localhost:5173/?demo=de-gerlache). If the backend is unavailable, the app labels its placeholder results as sample data; **Enter rover** still opens using the region's preset Earth terrain.

## 🚀 Quick Start (30 Seconds)

**Just double-click `START.bat`** in this folder. The script will:
1. Set up Python environment automatically
2. Start the backend and frontend servers
3. Open the app in your browser
4. You're ready to explore! 🌙

**That's it.** No manual setup needed. Skip to [Using the App](#using-the-app) below.

---

## 💻 System Requirements

- **Windows 10+** (or macOS/Linux with manual setup)
- **Python 3.8+** installed and in your PATH
  - *Not sure if Python is installed?* Run `python --version` in PowerShell
  - *Need to install Python?* Go to [python.org](https://python.org), check "Add Python to PATH"
- **Modern web browser** (Chrome, Firefox, Safari, Edge)
- **~500 MB disk space** for virtual environment

---

## 📋 What This App Does

This app helps find Earth locations that resemble candidate sites for the **Artemis III lunar base** (planned for the Moon's south pole).

**How it works:**
1. View the flat south-pole map showing 9 candidate regions. The browser image is a resized copy of `South_Pole.png`, registered against the previous polar map; region positions are approximate.
2. Select a lunar region by clicking its marker or colored box
3. Review its Earth terrain matches and select one for a detailed comparison
4. Open the rover simulation at the selected Earth location

**Why it matters:** Understanding Earth analogs helps prepare for actual lunar exploration and base construction.

---

## ✅ What You'll See When It Works

- ✓ South-pole map loads with 9 colored regions visible
- ✓ Browser shows app at `http://localhost:5173`
- ✓ No errors in browser console (press F12 to check)
- ✓ Can zoom and pan the south-pole map

---

## 🎮 Mouse Controls

| Action | Control |
|--------|---------|
| **Zoom** | Scroll mouse wheel |
| **Pan** | Left-click and drag |
| **Select Region** | Left-click on colored boxes |

Zooming out and panning are limited to the edges of the south-pole image.

## 📍 Important URLs

| Purpose | URL |
|---------|-----|
| **Main App** | http://localhost:5173 |
| **API Docs** | http://localhost:8000/docs |
| **API Endpoint** | http://localhost:8000/match |

---

## 🔧 Detailed Setup (If START.bat Fails)

If double-clicking `START.bat` doesn't work, try these steps:

### Option 1: PowerShell Script
```powershell
cd C:\Users\ryanf\Unity_Projects\NASA-apps-hackathon
powershell -ExecutionPolicy Bypass -File START.ps1
```

### Option 2: Manual Commands

**Terminal 1 — Backend Server:**
```powershell
cd C:\Users\ryanf\Unity_Projects\NASA-apps-hackathon

# One-time setup
python3 -m venv backend\.venv
backend\.venv\Scripts\pip install -r backend\requirements.txt

# Start the backend
backend\.venv\Scripts\uvicorn app:app --app-dir backend --reload --port 8000
```

**Terminal 2 — Frontend Server:**
```powershell
cd C:\Users\ryanf\Unity_Projects\NASA-apps-hackathon

# Start the frontend
python3 -m http.server 5173 --directory frontend
```

Then open **http://localhost:5173** in your browser.

---

## ❌ Troubleshooting

### "Python not found" Error
1. Install Python 3 from [python.org](https://python.org)
2. **Important:** Check "Add Python to PATH" during installation
3. Restart your computer
4. Try `START.bat` again

### "Port 8000 or 5173 already in use"
Another program is using these ports. Fix by:
```powershell
# See which Python processes are running
Get-Process python

# Kill a process (replace XXXX with the PID number)
Stop-Process -Id XXXX

# Or just restart your computer
```

### Website won't load or shows blank page
1. Wait 10 seconds — servers need time to start
2. Make sure **both** server windows are open (black terminal windows)
3. Refresh browser: **Ctrl+R**
4. Check browser console for errors: **F12**
5. Try clearing browser cache: **Ctrl+Shift+Delete**

### "Module not found" or Import Errors
```powershell
# Delete old virtual environment
Remove-Item -Recurse -Force backend\.venv

# Let START.bat recreate it
```

## 📁 Project Structure

```
NASA-apps-hackathon/
│
├── 🟩 START.bat              ← Double-click to run (Windows)
├── 🟩 START.ps1              ← Alternative (PowerShell)
├── 📘 README.md              ← This file
│
├── frontend/
│   ├── index.html            ← Main web page
│   ├── main.js               ← App logic + map controls
│   ├── regions.js            ← Lunar regions data
│   ├── style.css             ← Styling
│   └── [other assets]
│
├── backend/
│   ├── app.py                ← FastAPI server
│   ├── requirements.txt       ← Python dependencies
│   └── .venv/                ← Virtual environment (auto-created)
│
└── data/
    └── [sample data]         ← Placeholder data
```

---

## 🔍 How to Use the App

1. **Open the website:** Go to http://localhost:5173 (or wait for it to open automatically)

2. **Explore the moon:** 
   - Zoom with scroll wheel
   - Pan by dragging left mouse button
   - You should see 9 colored boxes on the lunar south pole

3. **Select a region:**
   - Click any colored box to select that region
   - You'll see region details appear

4. **Compare results:**
   - Click any result to see detailed comparison
   - Open the rover simulation at the selected Earth location

---

## 🛠️ Technical Details

### Technology Stack

- **Frontend:** HTML5, JavaScript, Leaflet
- **Backend:** Python, FastAPI, Uvicorn
- **Data:** CSV/JSON (NASA Earth and Moon data)

---

## 🚫 Stopping Servers

To stop the application:
1. Close the two black terminal windows (one for backend, one for frontend)
2. Or press **Ctrl+C** in each window

To restart: Just double-click `START.bat` again.

---

## 🤝 Contributing

This is a NASA Hackathon 2026 project. To contribute:

1. Create a new branch for your changes
2. Test thoroughly (both servers running, all features working)
3. Commit with clear messages
4. Push and create a pull request

---

## 📝 License

Check the repository for license information.

---

## 🎯 Next Steps

1. **Now:** Double-click `START.bat` to start the app
2. **Then:** Go to http://localhost:5173
3. **Explore:** Click lunar regions and search for Earth analogs
4. **Share:** Document interesting findings about Earth-Moon analogs

---

**Need help?** Check the troubleshooting section above, or review the detailed setup instructions in the [Detailed Setup](#detailed-setup-if-startbat-fails) section.

**Ready?** Double-click `START.bat` and start exploring! 🚀🌍🌙

