export type TextPart = {
  type: 'text';
  content: string;
};

export type ImagePart = {
  type: 'image';
  uri: string;
  alt?: string;
};

export type SourcePart = {
  type: 'sources';
  items: {
    uri: string;
    title: string;
  }[];
};

export type YouTubePart = {
    type: 'youtube';
    videos: {
        id: string;
        title: string;
        channel: string;
        description: string;
    }[];
};

export type MessagePart = TextPart | ImagePart | SourcePart | YouTubePart;

export interface Message {
  id: string;
  speaker: 'user' | 'model';
  parts: MessagePart[];
}
