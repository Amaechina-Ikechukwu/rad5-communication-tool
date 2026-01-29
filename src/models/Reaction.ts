import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/db';

interface ReactionAttributes {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt?: Date;
}

interface ReactionCreationAttributes extends Optional<ReactionAttributes, 'id'> {}

class Reaction extends Model<ReactionAttributes, ReactionCreationAttributes> implements ReactionAttributes {
  declare id: string;
  declare messageId: string;
  declare userId: string;
  declare emoji: string;
  declare readonly createdAt: Date;
}

Reaction.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    messageId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    emoji: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'reactions',
    timestamps: true,
    updatedAt: false,
    indexes: [
      {
        unique: true,
        fields: ['messageId', 'userId', 'emoji'],
      },
    ],
  }
);

export default Reaction;
