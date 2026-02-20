import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/db';

interface DirectMessageAttributes {
  id: string;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface DirectMessageCreationAttributes extends Optional<DirectMessageAttributes, 'id'> {}

class DirectMessage extends Model<DirectMessageAttributes, DirectMessageCreationAttributes> implements DirectMessageAttributes {
  declare id: string;
  declare createdBy: string;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

DirectMessage.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'direct_messages',
    timestamps: true,
  }
);

export default DirectMessage;
