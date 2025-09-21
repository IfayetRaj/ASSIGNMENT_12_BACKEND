const admin = require("./firebaseAdmin");

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized: No token" });
  }

  const idToken = authHeader.split(" ")[1];

  try {
    const decodedUser = await admin.auth().verifyIdToken(idToken);
    req.user = decodedUser;
    next();
  } catch (error) {
    console.error("Error verifying token:", error);
    return res.status(401).send({ message: "Unauthorized: Invalid token" });
  }
};

module.exports = verifyToken;
