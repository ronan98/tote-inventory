declare module "heic-decode" {
  interface DecodedImage { width: number; height: number; data: Uint8ClampedArray; }
  interface ImageEntry { width: number; height: number; decode(): Promise<DecodedImage>; }
  interface ImageCollection extends Array<ImageEntry> { dispose(): void; }
  const decode: {
    (options: { buffer: Buffer }): Promise<DecodedImage>;
    all(options: { buffer: Buffer }): Promise<ImageCollection>;
  };
  export default decode;
}
