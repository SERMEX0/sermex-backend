require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");



const nodemailer = require("nodemailer");

// Agrega esto ANTES de tus rutas en server.js:
const app = express();

// Middlewares DEBEN ir después de crear app
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://sermex-frontend.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));



// la conexion  a MySQL
const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
/*
db.connect(err => {
  if (err) {
    console.error(" Error de conexión a MySQL:", err);
    return;
  }
  console.log(" Conectado a MySQL");
});
*/
// Configuración OAuth2 para Gmail



const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});



// 🔐 Ruta de Login
app.post("/login", (req, res) => {
  const { correo, password } = req.body;
  console.log("[LOGIN] Intento de acceso para:", correo);

  db.query("SELECT * FROM usuarios WHERE correo = ?", [correo], (err, results) => {
    if (err) {
      console.error("[LOGIN] Error en el servidor:", err);
      return res.status(500).json({ error: "Error en el servidor" });
    }
    if (results.length === 0) {
      console.warn("[LOGIN] Usuario no encontrado:", correo);
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const user = results[0];

    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) {
        console.error("[LOGIN] Error al comparar contraseña:", err);
        return res.status(500).json({ error: "Error al comparar contraseña" });
      }
      if (!isMatch) {
        console.warn("[LOGIN] Contraseña incorrecta para:", correo);
        return res.status(401).json({ error: "Contraseña incorrecta" });
      }

      const token = jwt.sign({ id: user.id, correo: user.correo }, process.env.JWT_SECRET || "secreto", { expiresIn: "1h" });

      console.log("[LOGIN] Usuario autenticado correctamente:", correo);

      res.json({ 
        mensaje: "Inicio de sesión exitoso", 
        token,
        user: {
          id: user.id,
          correo: user.correo
        }
      });
    });
  });
});

// 🔏 Ruta para Registrar Usuario
app.post("/register", (req, res) => {
  const { correo, password } = req.body;

  bcrypt.hash(password, 10, (err, hash) => {
    if (err) return res.status(500).json({ error: "Error al encriptar contraseña" });

    db.query("INSERT INTO usuarios (correo, password) VALUES (?, ?)", [correo, hash], (err, result) => {
      if (err) return res.status(500).json({ error: "Error al registrar usuario" });

      res.json({ mensaje: "Usuario registrado correctamente" });
    });
  });
});

// Ruta para enviar correo de garantía
app.post('/api/enviar-garantia', authenticateToken, async (req, res) => {
   // ... el resto igual, pero SIN los res.header de CORS aquí
  

  const { vendedorEmail, datosFormulario, documentoBase64, imagenes } = req.body;
  
  try {
    // Validación básica
    if (!documentoBase64) {
      return res.status(400).json({ 
        success: false,
        error: 'El documento está vacío' 
      });
    }

    // Procesar adjuntos
    const attachments = [{
      filename: `garantia_${Date.now()}.docx`,
      content: documentoBase64,
      encoding: 'base64'
    }];

    // Procesar imágenes
    if (imagenes && imagenes.length > 0) {
      imagenes.forEach((img, index) => {
        const extension = img.name.split('.').pop().toLowerCase();
        attachments.push({
          filename: `imagen_${index + 1}.${extension}`,
          content: img.data,
          encoding: 'base64',
          contentType: `image/${extension === 'jpg' ? 'jpeg' : extension}`
        });
      });
    }

    // Configurar correo
    const mailOptions = {
      from: `"SERMEX" <${process.env.GMAIL_USER}>`,
      to: vendedorEmail,
      subject: `Garantía - ${datosFormulario.CLIENTE || 'Cliente'}`,
      html: `<p>Solicitud de garantía enviada</p>`,
      attachments: attachments
    };

    // Enviar correo
    await transporter.sendMail(mailOptions);
    
    // Respuesta consistente en JSON
    res.status(200).json({ 
      success: true,
      message: 'Correo enviado correctamente',
      attachments: attachments.length
    });

  } catch (error) {
    console.error('Error en el servidor:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error al enviar el correo',
      details: error.message
    });
  }
});


// Ruta para obtener lista de vendedores
app.get('/api/vendedores', authenticateToken, (req, res) => {
  const vendedores = [
    { id: 1, nombre: "Efren Castillo", email: "ecastillo@sermex.mx" },
    { id: 2, nombre: "Jhonatan Zavala", email: "jzavala@sermex.mx" },
    { id: 3, nombre: "Osvaldo", email: "julioosvaldoguzmancorrea53@gmail.com" }
  ];
  res.json(vendedores);
});

// 📝 Ruta para enviar evaluación
app.post("/api/evaluaciones", authenticateToken, (req, res) => {
  const { producto_id, puntuacion, comentario, sugerencias } = req.body;
  const usuario_id = req.user.id;

  db.query(
    "INSERT INTO evaluaciones_productos (usuario_id, producto_id, puntuacion, comentario, sugerencias) VALUES (?, ?, ?, ?, ?)",
    [usuario_id, producto_id, puntuacion, comentario, sugerencias],
    (err, result) => {
      if (err) {
        console.error("Error al guardar evaluación:", err);
        return res.status(500).json({ error: "Error al guardar evaluación" });
      }
      res.json({ mensaje: "Evaluación guardada correctamente" });
    }
  );
});

// 🔍 Ruta para obtener evaluaciones de un producto
app.get("/api/evaluaciones/:producto_id", (req, res) => {
  const { producto_id } = req.params;

  db.query(
    `SELECT e.*, u.correo 
     FROM evaluaciones_productos e
     JOIN usuarios u ON e.usuario_id = u.id
     WHERE e.producto_id = ?`,
    [producto_id],
    (err, results) => {
      if (err) {
        console.error("Error al obtener evaluaciones:", err);
        return res.status(500).json({ error: "Error al obtener evaluaciones" });
      }
      res.json(results);
    }
  );
});

// Obtener producto por ID
app.get('/api/productos/:id', (req, res) => {
  const { id } = req.params;
  db.query('SELECT * FROM productos WHERE id = ?', [id], (err, results) => {
    if (err) return res.status(500).json({ error: "Error al obtener producto" });
    if (results.length === 0) return res.status(404).json({ error: "Producto no encontrado" });
    res.json(results[0]);
  });
});

// Middleware para autenticar token JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET || "secreto", (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

//prueba
// 📧 Ruta de prueba para correos (elimínala después de probar)
app.get('/test-mail', async (req, res) => {
  try {
    await transporter.sendMail({
      to: 'julioosvaldoguzmancorrea53@gmail.com', // Tu correo personal
      from: `"Prueba SERMEX" <${process.env.GMAIL_USER}>`,
      subject: 'PRUEBA SERMEX - ' + new Date().toLocaleTimeString(),
      text: 'Si recibes esto, el correo está bien configurado',
      html: '<p>Este es un <strong>correo de prueba</strong> enviado desde SERMEX</p>'
    });
    res.send('✅ Correo de prueba enviado! Revisa tu bandeja de entrada y spam');
  } catch (error) {
    console.error('❌ Error en prueba:', error);
    res.send(`❌ Error: ${error.message}`);
  }
});

// Asegúrate que esta ruta esté ANTES del app.listen()
app.get('/api/logistica/:correo', (req, res) => {
  const { correo } = req.params;
  console.log("Solicitud recibida para correo:", correo); // Para depuración
  
  db.query(
    `SELECT * FROM logistica WHERE correo_cliente = ? ORDER BY fecha_creacion DESC`,
    [correo],
    (err, results) => {
      if (err) {
        console.error("Error en BD:", err);
        return res.status(500).json({ error: "Error al consultar" });
      }
      console.log("Resultados encontrados:", results); // Para depuración
      res.json(results);
    }
  );
});

// 🚀 Iniciar Servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});


app.get("/", (req, res) => {
  res.send("🚀 Servidor funcionando correctamente");
});


//cambio de contraseñas
// 🔐 Ruta para cambiar contraseña
// 🔐 Ruta para cambiar contraseña (mejorada)
app.post("/change-password", authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  // Validación básica
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Todos los campos son requeridos" });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
  }

  try {
    // 1. Verificar contraseña actual
    const [user] = await db.promise().query("SELECT password FROM usuarios WHERE id = ?", [userId]);
    if (!user.length) return res.status(404).json({ error: "Usuario no encontrado" });

    const isMatch = await bcrypt.compare(currentPassword, user[0].password);
    if (!isMatch) return res.status(401).json({ error: "Contraseña actual incorrecta" });

    // 2. Hashear nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 3. Actualizar en la base de datos
    await db.promise().query("UPDATE usuarios SET password = ? WHERE id = ?", [hashedPassword, userId]);

    res.json({ success: true, message: "Contraseña actualizada correctamente" });

  } catch (error) {
    console.error("Error en change-password:", error);
    res.status(500).json({ error: "Error en el servidor al cambiar contraseña" });
  }
});


// Endpoint para ADMIN actualizar estado
// Endpoint para actualizar estado (sin protección temporalmente)
// Ruta para actualizar el estado y notas de un pedido logístico
app.put('/api/logistica/actualizar', (req, res) => {
  const { rma_id, nuevo_estado, notas } = req.body;

  // Validación básica
  if (!rma_id || !nuevo_estado) {
    return res.status(400).json({ error: "Los campos 'rma_id' y 'nuevo_estado' son obligatorios" });
  }

  db.query(
    `UPDATE logistica SET 
      estado = ?, 
      detalles = ?,
      fecha_actualizacion = CURRENT_TIMESTAMP 
      WHERE rma_id = ?`,
    [nuevo_estado, notas || null, rma_id], // notas es opcional
    (err, result) => {
      if (err) {
        console.error("Error en la base de datos:", err);
        return res.status(500).json({ error: "Error interno al actualizar" });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "No se encontró el RMA especificado" });
      }
      res.json({ success: true, message: "Estado actualizado correctamente" });
    }
  );
});

// NO incluyas la función borrarCompletados ni el setInterval




// Ruta de prueba (¡sin base de datos!)
app.get('/api/test', (req, res) => {
  console.log("✅ Ruta /api/test funcionando");
  res.json({ mensaje: "¡El servidor responde correctamente!" });
});
