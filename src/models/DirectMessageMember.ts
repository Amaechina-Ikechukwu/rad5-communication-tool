import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/db';

interface DirectMessageMemberAttributes {
  id: string;
  dmId: string;
  userId: string;
  isArchived: boolean;
  isStarred: boolean;
  isMuted: boolean;
  lastReadAt: Date | null;
  clearedAt: Date | null;
  joinedAt?: Date;
}

interface DirectMessageMemberCreationAttributes extends Optional<DirectMessageMemberAttributes, 'id' | 'isArchived' | 'isStarred' | 'isMuted' | 'lastReadAt' | 'clearedAt'> {}

class DirectMessageMember extends Model<DirectMessageMemberAttributes, DirectMessageMemberCreationAttributes> implements DirectMessageMemberAttributes {
  declare id: string;
  declare dmId: string;
  declare userId: string;
  declare isArchived: boolean;
  declare isStarred: boolean;
  declare isMuted: boolean;
  declare lastReadAt: Date | null;
  declare clearedAt: Date | null;
  declare readonly joinedAt: Date;
}

DirectMessageMember.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    dmId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
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
    clearedAt: {
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
    tableName: 'direct_message_members',
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['dmId', 'userId'],
      },
    ],
  }
);

export default DirectMessageMember;
