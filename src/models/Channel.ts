import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/db';

interface AttachmentInfo {
  name: string;
  url: string;
  type: string;
}

interface ChannelAttributes {
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  isGroup: boolean;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ChannelCreationAttributes extends Optional<ChannelAttributes, 'id' | 'description' | 'avatar' | 'isGroup'> {}

class Channel extends Model<ChannelAttributes, ChannelCreationAttributes> implements ChannelAttributes {
  declare id: string;
  declare name: string;
  declare description: string | null;
  declare avatar: string | null;
  declare isGroup: boolean;
  declare createdBy: string;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

Channel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    avatar: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    isGroup: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'channels',
    timestamps: true,
  }
);

export default Channel;
