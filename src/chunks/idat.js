import Chunk, { CHUNK_CRC32_SIZE } from './chunk';
import { ChunkHeaderSequences, ColorTypes, BitDepths } from '../util/constants';
import {
  determinePixelColorSize,
  determineHasAlphaSample,
  determineDataRowLength,
} from '../util/pixels';
import { indexOfSequence, packByteData, unpackByteData } from '../util/typed-array';
import {
  defilter,
  addFilterFields,
  removeFilterFields,
} from '../util/compress-decompress';

const HEADER = 'IDAT';
const DEFLATE_BLOCKS_SIZE = 2;
const ZLIB_HEADER_SIZE = 5;
const ADLER_BASE  = 65521; // Largest prime smaller than 65536
const ADLER_NMAX = 5552;  // Largest n such that 255n(n + 1) / 2 + (n + 1)(_BASE - 1) <= 2^32 - 1
const ADLER_CHECKSUM_SIZE = 4;

export default class IDAT extends Chunk {
  constructor(options) {
    super(HEADER);

    this.applyLayoutInformation({
      width: options.width,
      height: options.height,
      depth: options.depth,
      colorType: options.colorType,
      numberOfPixels: options.numberOfPixels,
    });

    this._zlibLib = null;

    const chunkLength = this.calculateChunkLength();
    this.initialize(chunkLength);
    // this.initializeDeflateBlockHeaders();
    const pixelAndFilterSize = this.calculatePixelAndFilterSize();
    this._pixelData = new Uint8ClampedArray(pixelAndFilterSize);
  }

  /**
   * @todo
   * Remove.  Just for testing
   */
  // get pixels() {
  //   // This needs to be fixed to just return pixels
  //   return this._pixelData;
  // }

  getData(inRgbaFormat) {
    return this._pixelData;
  }

  set width(value) {
    this._width = value;
  }

  set height(value) {
    this._height = value;
  }

  set colorType(value) {
    this._colorType = value;
  }

  set numberOfPixels(value) {
    this._numberOfPixels = value;
  }

  applyLayoutInformation(info) {
    this._width = info.width;
    this._height = info.height;
    this._depth = info.depth;
    this._colorType = info.colorType;
    this._numberOfPixels = info.numberOfPixels;

    this._pixelColorSize = determinePixelColorSize(this._colorType);
    this._hasAlphaSample = determineHasAlphaSample(this._colorType);
  }

  /**
   * @todo
   * Move to a separate library, maybe something for all compression-decompression.
   */
  // initializeDeflateBlockHeaders() {
  //   const pixelAndFilterSize = this.calculatePixelAndFilterSize();

  //   for (let i = 0; (i << 16) - 1 < pixelAndFilterSize; i++) {
  //     console.log('calculating deflate...', i, (i << 16) - 1, i + 0xffff, pixelAndFilterSize);
  //     let size, bits;
  //     if (i + 0xffff < pixelAndFilterSize) {
  //       console.log('deflate less than')
  //       size = 0xffff;
  //       bits = 0x00;
  //       // bits = "\x00";

  //     } else {
  //       console.log('deflate greater than or equal')

  //       size = pixelAndFilterSize - (i << 16) - i;
  //       bits = 0x01;
  //       // bits = "\x01";

  //     }
  //     let offset = 8 + 2 + (i << 16) + (i << 2);
  //     offset = this.buffer.writeUint8At(offset, bits);
  //     offset = this.buffer.writeUint16At(offset, size, true);
  //     this.buffer.writeUint16At(offset, ~size, true);
  //     console.log('deflate headers, rnpng ->', 8 + 2 + (i << 16) + (i << 2), bits, size);
  //     // write(this.buffer, 8 + 2 + (i << 16) + (i << 2), bits, byte2lsb(size), byte2lsb(~size));
  //     // write(this.buffer, 8 + 2 + (i << 16) + (i << 2), bits, byte2lsb(size), byte2lsb(~size));
  //   }
  // }

  update() {
    const chunkSize = this.calculateChunkLength();
    const payloadSize = this.calculatePayloadSize();

    this.buffer.writeUint32(payloadSize);
    this.buffer.writeString8(HEADER);

    // console.log('updating -->', this._pixelData.length, this._height);

    /*
    differs by bit depth
    ? Math.ceil(this._pixelData / (8 / bit depth));
    */
    // const packedPixelData = new Uint8ClampedArray(128);
    console.log('packing data -->');
    const packedPixelData = Uint8ClampedArray.from(packByteData(this._pixelData, this._depth));
    console.log('packed data -->', packedPixelData);
    // const packedPixelData = Uint8ClampedArray.from(this._pixelData);
    console.log('adding filter fields -->');
    // const pixelAndFilterData = new Uint8ClampedArray(packedPixelData.length + this._height);
    // this.prependFilterFields(packedPixelData, pixelAndFilterData, 4);

    const pixelAndFilterData = Uint8ClampedArray.from(
      addFilterFields(
        packedPixelData,
        determineDataRowLength(this._depth, this._colorType, this._width),
        this._height
      )
    );
    // this.prependFilterFields(packedPixelData, pixelAndFilterData, this._depth * 4 * 3);

    // console.log('deflating pixel data -->');
    const compressedPixelAndFilterData = this._zlibLib.deflate(pixelAndFilterData);
    this.buffer.copyFrom(compressedPixelAndFilterData);

    const crc = this.calculateCrc32();
    this.buffer.writeUint32At(chunkSize - CHUNK_CRC32_SIZE, crc);
  }

  load(abuf) {
    const chunkLength = this.calculateChunkLength();
    this.initialize(chunkLength);

    const dataOffset = this.calculateDataOffset();
    const compressedZlibData = abuf.subarray(dataOffset);

    const uncompressedData = this._zlibLib.inflate(compressedZlibData);
    const fullPixelSize = this._pixelColorSize + (this._hasAlphaSample ? 1 : 0);

    if (this._depth >= BitDepths.EIGHT && ColorTypes.INDEXED !== this._colorType) {
      defilter(uncompressedData, this._width, fullPixelSize);
    }

    console.log('uncompressed data -->', uncompressedData);

    const pixelOnlyData = Uint8ClampedArray.from(
      removeFilterFields(
        uncompressedData,
        determineDataRowLength(this._depth, this._colorType, this._width),
        this._height
      )
    );
    // this.trimFilterFields(uncompressedData, pixelOnlyData, this._depth * 4 * 3 + 1);

    console.log('pixels only -->', pixelOnlyData);

    this._pixelData = Uint8ClampedArray.from(unpackByteData(pixelOnlyData, this._depth));

    console.log('= --->', this._pixelData);
  }

  _setSingleValuePixel(index, value) {
    // if (index >= this._numberOfPixels * this._pixelSize) {
    //   console.log('problem index', index, value);
    //   throw new Error('Index out of range for pixels');
    // }
    this._pixelData[index] = value;
  }

  _setRgbPixel(index, pixel) {
    // console.log('index', index);
    this._pixelData[index++] = pixel[0]; // red
    this._pixelData[index++] = pixel[1]; // green
    this._pixelData[index++] = pixel[2]; // blue
  }

  setPixel(pos, pixel) {
    let index;
    if (Array.isArray(pos) && pos.length === 2) {
      index = this.translateXyToIndex(...pos);
    } else {
      index = pos;
    }

    // if (this._colorType === ColorTypes.GRAYSCALE ||
    //   this._colorType === ColorTypes.GRAYSCALE_AND_ALPHA ||
    //   this._colorType === ColorTypes.INDEXED) {
    if (Array.isArray(pixel)) {
      this._setRgbPixel(index, pixel);
    } else {
      this._setSingleValuePixel(index, pixel);
    }
    return this;
  }

  /**
   * It's possible for a Truecolor and a Truecolor (2) with alpha (6) to
   * have paleltte indices as well, but that's not supported in this
   * implementation.
   */
  getPixelPaletteIndices() {
    if (this._colorType !== ColorTypes.INDEXED) {
      return [];
    }
    return new Set(Array.from(new Set(this._pixelData)).sort((a, b) => a - b));
  }

  translateXyToIndex(x, y) {
    const fullPixelSize = this._pixelColorSize + (this._hasAlphaSample ? 1 : 0);
    return y * (this._width * fullPixelSize) + (x * fullPixelSize);
    // return y * (this._width * fullPixelSize + 1) + (x * fullPixelSize) + 1;
  }

  verify(bufView) {
    return indexOfSequence(bufView, ChunkHeaderSequences[HEADER]) !== -1;
  }

  applyZlibLib(lib) {
    if (typeof lib.inflate !== 'function' || typeof lib.deflate !== 'function') {
      throw new Error('zlib library is missing required methods');
    }

    this._zlibLib = lib;
  }

  calculatePixelAndFilterSize() {
    const fullPixelSize = this._pixelColorSize + (this._hasAlphaSample ? 1 : 0);
    return (this._width * fullPixelSize + 1) * this._height;
    // return (this._numberOfPixels * this._pixelSize + 1) * this._height;
  }

  calculateAdler32() {
    let s1 = 1;
    let s2 = 0;
    let n = ADLER_NMAX;
  
    for (let y = 0; y < this._height; y++) {
      for (let x = -1; x < this._width; x++) {
        s1 = s1 + this._pixelData[this.translateXyToIndex(x, y)];
        s2 = s2 + s1;
        n = n - 1;
        if (n == 0) {
          s1 %= ADLER_BASE;
          s2 %= ADLER_BASE;
          n = ADLER_NMAX;
        }
      }
    }
    s1 = s1 % ADLER_BASE;
    s2 = s2 % ADLER_BASE;

    return [s1, s2];
  }

  calculatePayloadSize(pixelAndFilterSize = -1) {
    if (pixelAndFilterSize === -1) {
      pixelAndFilterSize = this.calculatePixelAndFilterSize();
    }
    return DEFLATE_BLOCKS_SIZE
      + pixelAndFilterSize  // Row filter and pixel data
      + ZLIB_HEADER_SIZE * Math.floor((0xfffe + pixelAndFilterSize) / 0xffff)  // Zlib blocks
      + ADLER_CHECKSUM_SIZE;
  }

  calculateChunkLength(payloadSize = -1) {
    if (payloadSize === -1) {
      payloadSize = this.calculatePayloadSize();
    }
    return super.calculateChunkLength() + payloadSize;
  }
}
