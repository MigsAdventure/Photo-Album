export default function handler(req, res) {
  res.status(200).json({ 
    success: true, 
    message: "Ultra minimal test - plain JavaScript",
    timestamp: new Date().toISOString()
  });
}
