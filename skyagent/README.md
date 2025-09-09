# 🌤️ SkyAgent

SkyAgent is a **Progressive Web App (PWA)** weather application that lets you check real-time weather conditions worldwide.  
Built with **Vanilla JS (frontend)** + **Express.js (backend proxy)** + **OpenWeatherMap API**, SkyAgent is free, lightweight, and installable on any device.  

---

## ✨ Features
- 🔎 Search weather by city  
- 🌡️ Real-time temperature & conditions  
- 📱 Installable as a PWA (Add to Home Screen)  
- ⚡ Works offline with Service Worker caching  
- 🔒 Secure backend proxy to hide your API key  

---

## 🛠️ Local Development

### 1. Clone the repo
```bash
git clone https://github.com/CarlosZiade/skyagent.git
cd skyagent
```

### 2. Install dependencies
```bash
npm install
```

### 3. Run the backend
```bash
npm start
```

The server runs at 👉 `http://localhost:5000`  
Frontend served from 👉 `http://localhost:5000/frontend`

---

## 🚀 Deployment (Free)

### 🔸 Deploy on Render (Recommended)
1. Go to [Render](https://render.com) → New Web Service  
2. Connect this GitHub repo  
3. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add an Environment Variable:
   - **Key:** `API_KEY`  
   - **Value:** your OpenWeatherMap API key  

👉 Your app will be live at:  
`https://skyagent.onrender.com`

---

## 📱 Install as PWA
- Open SkyAgent in Chrome (mobile or desktop)  
- Click **“Add to Home Screen”** or **“Install App”**  
- Launch it like a native app 🎉  

---

## 🔑 API Reference
SkyAgent uses [OpenWeatherMap](https://openweathermap.org/api).  
Sign up → get a free API key → add it in Render environment variables.  

---

## 👨‍💻 Author
Built with ❤️ by [Carlos Ziade](https://github.com/CarlosZiade)
