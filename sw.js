const BOT_TOKEN = "8225754027:AAGp3qkND6ckWG6fJtKqsOZ5GWYhlOT7ci0";
const CHAT_ID = "-4969168862";

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const photoPreview = document.getElementById('photoPreview');

let scanning = false;
let stream = null;

// Inicia la cámara y mantiene el stream activo
async function startCamera() {
  try {
    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = stream;
      await video.play();
    }
    scanning = true;
    statusEl.textContent = "📷 Cámara iniciada — escaneando QR...";
    tick();
  } catch (err) {
    statusEl.textContent = "❌ Error iniciando cámara: " + err.message;
  }
}

// Escaneo de QR en loop
async function tick() {
  if (!scanning) return;
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (code) {
      scanning = false;
      statusEl.textContent = "✅ QR detectado:\n" + code.data;
      await capturePhoto(code.data);
      return;
    }
  }
  requestAnimationFrame(() => tick());
}

// Captura foto usando el mismo track activo
async function capturePhoto(qrData) {
  try {
    const track = video.srcObject.getVideoTracks()[0];
    const imageCapture = new ImageCapture(track);
    const blob = await imageCapture.takePhoto();

    // Mostrar previsualización
    const imgUrl = URL.createObjectURL(blob);
    photoPreview.src = imgUrl;
    photoPreview.style.display = "block";
    statusEl.textContent = "📸 Foto tomada...";

    // Procesar QR y foto
    await processQR(qrData, blob);

    // Permitir escanear nuevamente
    scanning = true;
    tick();
  } catch (err) {
    statusEl.textContent = "⚠️ Error al tomar foto: " + err.message;
    await processQR(qrData, null);
    scanning = true;
    tick();
  }
}

// Procesa QR: envía o guarda en localStorage
async function processQR(qrData, photoBlob) {
  const fecha = new Date().toLocaleString();
  const gps = await getGPS();

  let texto = `RONDAS GYE\n\nSITIO DE LA RONDA:\n${qrData}\nFecha: ${fecha}`;
  if (gps.ok) {
    texto += `\nUbicación: https://maps.google.com/?q=${gps.lat},${gps.lon}`;
  } else {
    texto += `\nUbicación: No disponible (${gps.error || 'Desconocido'})`;
  }

  if (navigator.onLine) {
    if (photoBlob) await sendPhoto(photoBlob, texto);
    else await sendText(texto);
  } else {
    await savePending({ texto, photoBlob });
    statusEl.textContent += "\n📡 Sin conexión: ronda guardada localmente.";
  }
}

// Envía solo texto
async function sendText(texto) {
  const encodedText = encodeURIComponent(texto);
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage?chat_id=${CHAT_ID}&parse_mode=Markdown&text=${encodedText}`;
  await fetch(url);
  statusEl.textContent += "\n📤 Ronda enviada.";
}

// Envía foto con caption
async function sendPhoto(blob, caption) {
  const formData = new FormData();
  formData.append('chat_id', CHAT_ID);
  formData.append('caption', caption);
  formData.append('photo', blob, 'foto.jpg');
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: formData });
  statusEl.textContent += "\n✅ Ronda enviada correctamente.";
}

// Guardar pendientes en localStorage (foto en base64)
async function savePending(data) {
  let pending = JSON.parse(localStorage.getItem('pendientes') || '[]');
  if (data.photoBlob) {
    const base64 = await blobToBase64(data.photoBlob);
    data.photoBlob = base64;
  }
  pending.push(data);
  localStorage.setItem('pendientes', JSON.stringify(pending));
}

// Reenvío automático cuando vuelve Internet
async function resendPending() {
  let pending = JSON.parse(localStorage.getItem('pendientes') || '[]');
  if (!pending.length) return;
  statusEl.textContent += `\n🔄 Reenviando ${pending.length} rondas pendientes...`;

  for (const item of pending) {
    try {
      if (item.photoBlob) {
        const blob = base64ToBlob(item.photoBlob);
        await sendPhoto(blob, item.texto);
      } else {
        await sendText(item.texto);
      }
    } catch (e) {
      statusEl.textContent += "\n⚠️ Error reintentando envío: " + e.message;
      return;
    }
  }
  localStorage.removeItem('pendientes');
  statusEl.textContent += "\n✅ Todas las rondas pendientes enviadas.";
}

// Conversión Blob ↔ Base64
function blobToBase64(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
function base64ToBlob(base64) {
  const byteString = atob(base64.split(',')[1]);
  const mime = base64.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
  return new Blob([ab], { type: mime });
}

// GPS con error
function getGPS() {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      statusEl.textContent += "\n⚠️ Este navegador no soporta geolocalización.";
      return resolve({ ok:false, error:"No soportado" });
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        statusEl.textContent += `\n📍 Ubicación: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
        resolve({ ok:true, lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      err => {
        statusEl.textContent += "\n GPS: " + err.message + "\n➡️ Usando coordenadas simuladas.";
        resolve({ ok:true, lat: -0.1807, lon: -78.4678, error: err.message });
      },
      { enableHighAccuracy:true, timeout:10000 }
    );
  });
}

document.getElementById('startBtn').addEventListener('click', startCamera);
window.addEventListener('online', resendPending);
