import Chunk from './chunk';
import {
  readUint8At,
  readUint16At,
} from '../util/typed-array';
import {
  determineBackgroundSamplesPerEntry,
  isIndexed,
} from '../util/png-pixels';

const HEADER = 'bKGD';

export default class bKGD extends Chunk {
  constructor(options) {
    super(HEADER);
    
    this._colorType = options.colorType;
    // This will need to change if we support greater than 8 bit samples
    this._backgroundColor = new Uint8ClampedArray(determineBackgroundSamplesPerEntry(this._colorType));

    const chunkLength = this.calculateChunkLength();
    this.initialize(chunkLength);
  }

  set colorType(value) {
    this._colorType = value;
  }

  update() {
    const payloadSize = this.calculatePayloadSize();

    this.buffer.writeUint32(payloadSize);
    this.buffer.writeString8(HEADER);

    if (isIndexed(this._colorType)) {
      this.buffer.writeUint8(this._backgroundColor[0]); 
    } else {
      for (let i = 0; i < this._backgroundColor.length; i++) {
        this.buffer.writeUint16(this._backgroundColor[i], true); 
      }
    }

    const crc = this.calculateCrc32();
    this.buffer.writeUint32(crc);
  }

  load(abuf) {
    const chunkLength = this.calculateChunkLength();
    this.initialize(chunkLength);

    const backgroundInfo = abuf.subarray(
      this.calculateDataOffset(),
      this.calculateDataOffset() + this.calculatePayloadSize()
    );

    const dataOffset = this.calculateDataOffset();
    let color = [];
    if (isIndexed(this._colorType)) {
      color.push(readUint8At(backgroundInfo, dataOffset));
    } else {
      const numberOfSamples = determineBackgroundSamplesPerEntry(this._colorType);
      for (let i = 0, offset = dataOffset; i < numberOfSamples; i++, offset += 2) {
        color.push(readUint16At(backgroundInfo, dataOffset, true));
      }
    }
    this.setBackgroundColor(color);
  }

  setBackgroundColor(color) {
    const requiredSamples = determineBackgroundSamplesPerEntry(this._colorType);
    if (color.length !== requiredSamples) {
      throw new Error(`Incorrect number of samples supplied for background (${requiredSamples} expected)`);
    }

    for (let i = 0; i < color.length; i++) {
      this._backgroundColor[i] = color[i];
    }
  }

  getBackgroundColor() {
    return this._backgroundColor;
  }

  calculatePayloadSize() {
    if (isIndexed(this._colorType)) {
      return 1;
    } else {
      return determineBackgroundSamplesPerEntry(this._colorType) * 2;
    }
  }

  calculateChunkLength() {
    return super.calculateChunkLength() + this.calculatePayloadSize();
  }
}
