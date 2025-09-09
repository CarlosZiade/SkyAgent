async function getWeather() {
  const city = document.getElementById("city").value;
  if (!city) {
    document.getElementById("result").innerText = "⚠️ Please enter a city name.";
    return;
  }

  try {
    const res = await fetch(`/weather?city=${city}`);
    const data = await res.json();

    if (data.main) {
      document.getElementById("result").innerHTML =
        `<b>${data.name}</b>: ${data.main.temp}°C, ${data.weather[0].description}`;
    } else {
      document.getElementById("result").innerText = "❌ City not found!";
    }
  } catch (error) {
    document.getElementById("result").innerText = "⚠️ Error fetching weather data.";
  }
}
