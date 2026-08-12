import sharp from "sharp";

export type WorksheetQuadrant = {
  number: number;
  base64Image: string;
};

const QUADRANT_LAYOUT: Array<{
  number: number;
  left: number;
  top: number;
  width: number;
  height: number;
}> = [
  { number: 1, left: 0, top: 0, width: 0.5, height: 0.5 },
  { number: 2, left: 0.5, top: 0, width: 0.5, height: 0.5 },
  { number: 3, left: 0, top: 0.5, width: 0.5, height: 0.5 },
  { number: 4, left: 0.5, top: 0.5, width: 0.5, height: 0.5 },
];

export async function splitWorksheetIntoQuadrants(
  imageBuffer: Buffer
): Promise<WorksheetQuadrant[]> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (width < 400 || height < 400) {
    return [];
  }

  const quadrants: WorksheetQuadrant[] = [];

  for (const region of QUADRANT_LAYOUT) {
    const left = Math.floor(width * region.left);
    const top = Math.floor(height * region.top);
    const cropWidth = Math.max(1, Math.floor(width * region.width));
    const cropHeight = Math.max(1, Math.floor(height * region.height));

    const cropped = await sharp(imageBuffer)
      .extract({
        left,
        top,
        width: Math.min(cropWidth, width - left),
        height: Math.min(cropHeight, height - top),
      })
      .jpeg({ quality: 82 })
      .toBuffer();

    quadrants.push({
      number: region.number,
      base64Image: cropped.toString("base64"),
    });
  }

  return quadrants;
}
