import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/db';

interface AudioInfo {
  url: string;
  duration: string;
}

interface PollInfo {
  options: string[];
  votes: { [option: string]: string[] };
}

interface MessageAttributes {
  id: string;
  channelId: string | null;
  dmId: string | null;
  senderId: string;
  text: string | null;
  attachments: string[];
  audio: AudioInfo | null;
  poll: PollInfo | null;
  isEdited: boolean;
  isDeleted: boolean;
  status: 'sent' | 'delivered' | 'read';
  deliveredAt: Date | null;
  readAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface MessageCreationAttributes extends Optional<MessageAttributes, 'id' | 'text' | 'attachments' | 'audio' | 'poll' | 'isEdited' | 'isDeleted' | 'status' | 'deliveredAt' | 'readAt' | 'channelId' | 'dmId'> {}

class Message extends Model<MessageAttributes, MessageCreationAttributes> implements MessageAttributes {
  declare id: string;
  declare channelId: string | null;
  declare dmId: string | null;
  declare senderId: string;
  declare text: string | null;
  declare attachments: string[];
  declare audio: AudioInfo | null;
  declare poll: PollInfo | null;
  declare isEdited: boolean;
  declare isDeleted: boolean;
  declare status: 'sent' | 'delivered' | 'read';
  declare deliveredAt: Date | null;
  declare readAt: Date | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  isWithinEditWindow(): boolean {
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
    return this.createdAt > twentyMinutesAgo;
  }
}

Message.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    channelId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    dmId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    senderId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    attachments: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    audio: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    poll: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    isEdited: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    status: {
      type: DataTypes.ENUM('sent', 'delivered', 'read'),
      defaultValue: 'sent',
    },
    deliveredAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'messages',
    timestamps: true,
    indexes: [
      {
        fields: ['channelId'],
      },
      {
        fields: ['dmId'],
      },
      {
        fields: ['senderId'],
      },
      {
        fields: ['createdAt'],
      },
    ],
  }
);

export default Message;
