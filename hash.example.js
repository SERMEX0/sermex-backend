const bcrypt = require("bcrypt");

// Ejemplo de lista de usuarios (NO uses datos reales aquí)
const usuarios = [
  { nombre: "UsuarioEjemplo", correo: "ejemplo@correo.com", password: "password123" },
  { nombre: "OtroUsuario", correo: "otro@correo.com", password: "abc456" },
  // Puedes agregar más usuarios de prueba aquí
];

// Recorrer la lista y generar hashes
usuarios.forEach((usuario) => {
  bcrypt.hash(usuario.password, 10, (err, hash) => {
    if (err) throw err;

    console.log("================================");
    console.log(`Nombre: ${usuario.nombre}`);
    console.log(`Correo: ${usuario.correo}`);
    console.log(`Password original: ${usuario.password}`);
    console.log(`Password encriptado: ${hash}`);
    console.log("================================");
  });
});