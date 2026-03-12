import cloudinary from '../config/cloudinary';
import { Readable } from 'stream';

export interface UploadResult {
  url: string;
  publicId: string;
  type: string;
  bytes: number | null;
  duration: number | null;
  format: string | null;
  originalFilename: string | null;
  width: number | null;
  height: number | null;
}

export const uploadToCloudinary = async (
  buffer: Buffer,
  folder: string,
  resourceType: 'image' | 'video' | 'raw' | 'auto' = 'auto'
): Promise<UploadResult> => {
  if (process.env.NODE_ENV === 'test') {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    return {
      url: `https://example.test/rad5-comms/${folder}/${suffix}`,
      publicId: `test/${folder}/${suffix}`,
      type: resourceType === 'auto' ? 'raw' : resourceType,
      bytes: buffer.length,
      duration: null,
      format: null,
      originalFilename: null,
      width: null,
      height: null,
    };
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `rad5-comms/${folder}`,
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (result) {
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            type: result.resource_type,
            bytes: typeof result.bytes === 'number' ? result.bytes : null,
            duration: typeof result.duration === 'number' ? result.duration : null,
            format: typeof result.format === 'string' ? result.format : null,
            originalFilename:
              typeof result.original_filename === 'string'
                ? result.original_filename
                : null,
            width: typeof result.width === 'number' ? result.width : null,
            height: typeof result.height === 'number' ? result.height : null,
          });
        }
      }
    );

    const readable = new Readable();
    readable._read = () => {};
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
};

export const deleteFromCloudinary = async (publicId: string): Promise<void> => {
  await cloudinary.uploader.destroy(publicId);
};

export const getFileType = (mimetype: string): 'image' | 'audio' | 'video' | 'file' => {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.startsWith('video/')) return 'video';
  return 'file';
};

