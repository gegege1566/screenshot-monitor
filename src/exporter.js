const { PDFDocument } = require('pdf-lib');
const fs = require('fs');

async function exportToPdf(imagePaths, outputPath) {
  if (!imagePaths.length) return 0;

  const pdfDoc = await PDFDocument.create();
  const maxW = 595;
  const maxH = 842;

  for (const imgPath of imagePaths) {
    const imgBytes = fs.readFileSync(imgPath);

    let image;
    if (imgPath.toLowerCase().endsWith('.png')) {
      image = await pdfDoc.embedPng(imgBytes);
    } else {
      image = await pdfDoc.embedJpg(imgBytes);
    }

    const { width, height } = image;
    const aspect = width / height;

    let pageW, pageH;
    if (width / maxW > height / maxH) {
      pageW = Math.min(width, maxW);
      pageH = pageW / aspect;
    } else {
      pageH = Math.min(height, maxH);
      pageW = pageH * aspect;
    }

    const page = pdfDoc.addPage([pageW, pageH]);
    page.drawImage(image, { x: 0, y: 0, width: pageW, height: pageH });
  }

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, pdfBytes);
  return imagePaths.length;
}

module.exports = { exportToPdf };
