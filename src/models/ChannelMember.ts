import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/db';

interface ChannelMemberAttributes {
  id: string;
  channelId: string;
  userId: string;
  role: 'admin' | 'member';
  joinedAt?: Date;
}

interface ChannelMemberCreationAttributes extends Optional<ChannelMemberAttributes, 'id' | 'role'> {}

class ChannelMember extends Model<ChannelMemberAttributes, ChannelMemberCreationAttributes> implements ChannelMemberAttributes {
  declare id: string;
  declare channelId: string;
  declare userId: string;
  declare role: 'admin' | 'member';
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
