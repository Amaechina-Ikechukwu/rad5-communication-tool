import cloudinary from '../config/cloudinary';
import type { MessageAttachment, PollInfo } from '../models/Message';
import type { UploadResult } from './cloudinary';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'webm', 'm4a', 'aac', 'flac']);

const toOptionalNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const getFileExtension = (value: string | null | undefined): string | null => {
  if (!value) return null;

  const [withoutQuery = value] = value.split('?');
  const [cleanValue = withoutQuery] = withoutQuery.split('#');
  const segments = cleanValue.split('.');
  if (segments.length < 2) {
    return null;
  }

  return segments.pop()?.toLowerCase() || null;
};

const getNameFromUrl = (url: string): string => {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split('/').pop() || 'file';
    return decodeURIComponent(lastSegment);
  } catch {
    const lastSegment = url.split('/').pop() || 'file';
    return decodeURIComponent(lastSegment);
  }
};

const inferAttachmentType = (input: {
  explicitType?: unknown;
  mimeType?: unknown;
  url?: unknown;
  name?: unknown;
}): MessageAttachment['type'] => {
  const explicitType = typeof input.explicitType === 'string' ? input.explicitType.toLowerCase() : '';
  if (explicitType === 'image' || explicitType === 'video' || explicitType === 'audio') {
    return explicitType;
  }

  const mimeType = typeof input.mimeType === 'string' ? input.mimeType.toLowerCase() : '';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';

  const extension = getFileExtension(
    typeof input.name === 'string'
      ? input.name
      : typeof input.url === 'string'
        ? input.url
        : null
  );

  if (!extension) return 'file';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  return 'file';
};

const buildThumbnailUrl = (
  publicId: string | null | undefined,
  url: string,
  type: MessageAttachment['type']
): string | null => {
  if (type === 'image') {
    return url;
  }

  if (type === 'video' && publicId) {
    try {
      const thumbnailUrl = cloudinary.url(publicId, {
        resource_type: 'video',
        secure: true,
        format: 'jpg',
        transformation: [{ width: 640, height: 640, crop: 'fill' }],
      });

      if (thumbnailUrl && !thumbnailUrl.includes('undefined')) {
        return thumbnailUrl;
      }
    } catch {
      // Fall back to the original asset URL when Cloudinary preview generation is unavailable.
    }

    return url;
  }

  return null;
};

export const parseDurationSeconds = (value: unknown): number | null => {
  const directValue = toOptionalNumber(value);
  if (directValue !== null) {
    return directValue;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  if (parts.length === 2) {
    const [minutes = 0, seconds = 0] = parts;
    return minutes * 60 + seconds;
  }

  if (parts.length === 3) {
    const [hours = 0, minutes = 0, seconds = 0] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  return null;
};

const parseSerializedValue = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

export const normalizePoll = (value: unknown): PollInfo | null => {
  const parsedValue = parseSerializedValue(value);
  const pollObject = parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
    ? (parsedValue as Record<string, unknown>)
    : null;

  const rawOptions = Array.isArray(parsedValue)
    ? parsedValue
    : Array.isArray(pollObject?.options)
      ? pollObject.options
      : [];

  const options = rawOptions.filter(
    (option): option is string => typeof option === 'string' && option.trim().length > 0,
  );

  if (!options.length) {
    return null;
  }

  const rawVotes = pollObject?.votes && typeof pollObject.votes === 'object'
    ? (pollObject.votes as Record<string, unknown>)
    : {};

  const votes: Record<string, string[]> = {};
  options.forEach((option) => {
    const voters = rawVotes[option];
    votes[option] = Array.isArray(voters)
      ? [...new Set(voters.filter((userId): userId is string => typeof userId === 'string'))]
      : [];
  });

  return { options, votes };
};

export const normalizeAttachmentInput = (value: unknown): MessageAttachment[] => {
  const parsedValue = parseSerializedValue(value);

  if (Array.isArray(parsedValue)) {
    return normalizeAttachments(parsedValue);
  }

  const attachment = normalizeAttachment(parsedValue);
  return attachment ? [attachment] : [];
};

export const normalizeAudioInput = (value: unknown): MessageAttachment | null => {
  return normalizeAudio(parseSerializedValue(value));
};

export const normalizeAttachment = (value: unknown): MessageAttachment | null => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    const type = inferAttachmentType({ url: value });
    return {
      name: getNameFromUrl(value),
      url: value,
      type,
      mimeType: null,
      size: null,
      duration: null,
      thumbnailUrl: buildThumbnailUrl(null, value, type),
    };
  }

  if (typeof value !== 'object') {
    return null;
  }

  const rawAttachment = value as Record<string, unknown>;
  const url = typeof rawAttachment.url === 'string' ? rawAttachment.url : null;
  if (!url) {
    return null;
  }

  const mimeType = typeof rawAttachment.mimeType === 'string' ? rawAttachment.mimeType : null;
  const type = inferAttachmentType({
    explicitType: rawAttachment.type,
    mimeType,
    url,
    name:
      typeof rawAttachment.name === 'string'
        ? rawAttachment.name
        : typeof rawAttachment.originalName === 'string'
          ? rawAttachment.originalName
          : null,
  });

  return {
    name:
      typeof rawAttachment.name === 'string'
        ? rawAttachment.name
        : typeof rawAttachment.originalName === 'string'
          ? rawAttachment.originalName
          : getNameFromUrl(url),
    url,
    type,
    mimeType,
    size: toOptionalNumber(rawAttachment.size),
    duration: parseDurationSeconds(rawAttachment.duration),
    thumbnailUrl:
      typeof rawAttachment.thumbnailUrl === 'string'
        ? rawAttachment.thumbnailUrl
        : buildThumbnailUrl(
            typeof rawAttachment.publicId === 'string' ? rawAttachment.publicId : null,
            url,
            type
          ),
  };
};

export const normalizeAttachments = (value: unknown): MessageAttachment[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((attachment) => normalizeAttachment(attachment))
    .filter((attachment): attachment is MessageAttachment => Boolean(attachment));
};

export const normalizeAudio = (value: unknown): MessageAttachment | null => {
  const attachment = normalizeAttachment(value);
  if (!attachment) {
    return null;
  }

  return {
    ...attachment,
    type: 'audio',
    thumbnailUrl: null,
  };
};

export const buildAttachmentFromUpload = (
  file: Express.Multer.File,
  uploadResult: UploadResult,
  overrides: Partial<MessageAttachment> = {}
): MessageAttachment => {
  const type = overrides.type || inferAttachmentType({
    explicitType: uploadResult.type,
    mimeType: file.mimetype,
    url: uploadResult.url,
    name: file.originalname,
  });

  return {
    name: overrides.name || file.originalname || uploadResult.originalFilename || getNameFromUrl(uploadResult.url),
    url: overrides.url || uploadResult.url,
    type,
    mimeType: overrides.mimeType === undefined ? file.mimetype || null : overrides.mimeType,
    size: overrides.size === undefined ? file.size || uploadResult.bytes : overrides.size,
    duration:
      overrides.duration === undefined
        ? parseDurationSeconds(uploadResult.duration)
        : overrides.duration,
    thumbnailUrl:
      overrides.thumbnailUrl === undefined
        ? buildThumbnailUrl(uploadResult.publicId, uploadResult.url, type)
        : overrides.thumbnailUrl,
  };
};

export const formatMessagePayload = (msg: any, userId: string, extra: Record<string, unknown> = {}) => {
  const attachments = normalizeAttachments(msg.attachments);
  const audio = normalizeAudio(msg.audio);
  const poll = normalizePoll(msg.poll);

  return {
    id: msg.id,
    sender: msg.sender,
    text: msg.text,
    time: msg.createdAt,
    isOwn: msg.senderId === userId,
    isEdited: Boolean(msg.isEdited),
    reactions: Array.isArray(msg.reactions)
      ? msg.reactions.map((reaction: any) => ({
          emoji: reaction.emoji,
          user: reaction.user,
        }))
      : [],
    attachments,
    audio,
    poll,
    hasImage: attachments.some((attachment) => attachment.type === 'image'),
    hasAudio: Boolean(audio),
    status: msg.status,
    deliveredAt: msg.deliveredAt,
    readAt: msg.readAt,
    ...extra,
  };
};

export const formatMediaPayload = (msg: any, userId?: string) => {
  const attachments = normalizeAttachments(msg.attachments);
  const audio = normalizeAudio(msg.audio);

  return {
    id: msg.id,
    sender: msg.sender,
    text: msg.text,
    time: msg.createdAt,
    isOwn: userId ? msg.senderId === userId : undefined,
    attachments,
    audio,
    hasImage: attachments.some((attachment) => attachment.type === 'image'),
    hasAudio: Boolean(audio),
  };
};

export const isMediaAttachment = (attachment: MessageAttachment): boolean => attachment.type !== 'file';

export const flattenMessageAttachments = (messages: any[], mode: 'media' | 'file') => {
  const items: Array<MessageAttachment & { messageId: string; time: Date; sender: any }> = [];

  messages.forEach((msg) => {
    normalizeAttachments(msg.attachments)
      .filter((attachment) => (mode === 'media' ? isMediaAttachment(attachment) : attachment.type === 'file'))
      .forEach((attachment) => {
        items.push({
          ...attachment,
          messageId: msg.id,
          time: msg.createdAt,
          sender: msg.sender,
        });
      });

    const audio = normalizeAudio(msg.audio);
    if (audio && mode === 'media') {
      items.push({
        ...audio,
        messageId: msg.id,
        time: msg.createdAt,
        sender: msg.sender,
      });
    }
  });

  return items;
};

