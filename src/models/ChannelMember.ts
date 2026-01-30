import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/db';

interface ChannelMemberAttributes {
  id: string;
  channelId: string;
  userId: string;
  role: 'admin' | 'member';
  isArchived: boolean;
  isStarred: boolean;
  isMuted: boolean;
  lastReadAt: Date | null;
  joinedAt?: Date;
}

interface ChannelMemberCreationAttributes extends Optional<ChannelMemberAttributes, 'id' | 'role' | 'isArchived' | 'isStarred' | 'isMuted' | 'lastReadAt'> {}

class ChannelMember extends Model<ChannelMemberAttributes, ChannelMemberCreationAttributes> implements ChannelMemberAttributes {
  declare id: string;
  declare channelId: string;
  declare userId: string;
  declare role: 'admin' | 'member';
  declare isArchived: boolean;
  declare isStarred: boolean;
  declare isMuted: boolean;
  declare lastReadAt: Date | null;
  declare readonly joinedAt: Date;
}

ChannelMember.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    channelId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM('admin', 'member'),
      defaultValue: 'member',
    },
    isArchived: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    isStarred: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    isMuted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    lastReadAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    joinedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'channel_members',
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['channelId', 'userId'],
      },
    ],
  }
);

export default ChannelMember;
