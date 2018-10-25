import Chunk from './chunk';
import { ColorTypes } from '../util/constants';

const HEADER = 'bKGD';

export default class bKGD extends Chunk {
  constructor(options) {
    super(HEADER);
    
    this._colorType = options.colorType;
    // This will need to change if we support greater than 8 bit samples
    this._backgroundColor = new Uint8ClampedArray(this._determineSamples(this._colorType));

    const chunkLength = this.calculateChunkLength();
    this.initialize(chunkLength);
  }

  set colorType(value) {
    this._colorType = value;
  }

  _determineNumberOfSamples(colorType) {
    if (ColorTypes.INDEXED === colorType
      || ColorTypes.GRAYSCALE === colorType
      || ColorTypes.GRAYSCALE_AND_ALPHA == colorType) {
      return 1;
    }
    return 3;
  }

  update() {
    const payloadSize = this.calculatePayloadSize();

    this.buffer.writeUint32(payloadSize);
    this.buffer.writeString8(HEADER);

    if (ColorTypes.INDEXED === this._colorType) {
      this.buffer.writeUint8(this._backgroundColor[0]); 
    } else {
      for (let i = 0; i < this._backgroundColor.length; i++) {
        this.buffer.writeUint16(this._backgroundColor[i], true); 
      }
    }

    const crc = this.calculateCrc32();
    this.buffer.writeUint32(crc);

    return this;
  }

  load(abuf) {
    const chunkLength = this.calculateChunkLength();
    this.initialize(chunkLength);
    this.buffer.copyInto(abuf, chunkLength);

    const dataOffset = this.calculateDataOffset();
    let color = [];
    if (ColorTypes.INDEXED === this._colorType) {
      color.push(this.buffer.readUint8At(dataOffset));
    } else {
      const numberOfSamples = this._determineNumberOfSamples(this._colorType);
      for (let i = 0, offset = dataOffset; i < numberOfSamples; i++, offset += 2) {
        color.push(this.buffer.readUint16At(dataOffset));
      }
    }
    this.setBackgroundColor(color);
  }

  setBackgroundColor(color) {
    const requiredSamples = this._determineNumberOfSamples(this._colorType);
    if (color.length !== requiredSamples) {
      throw new Error(`Incorrect number of samples supplied for backgroud (${requiredSamples} expected)`);
    }

    for (let i = 0; i < color.length; i++) {
      this._backgroundColor[i] = color[i];
    }
  }

  getBackgroundColor() {
    return this._backgroundColor;
  }

  calculatePayloadSize() {
    if (ColorTypes.INDEXED === this._colorType) {
      return 1;
    } else {
      return this._determineNumberOfSamples(this._colorType) * 2;
    }
  }

  calculateChunkLength() {
    return super.calculateChunkLength() + this.calculatePayloadSize();
  }
}