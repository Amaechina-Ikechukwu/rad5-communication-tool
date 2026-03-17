import { DataTypes, Model } from 'sequelize';
import type { Optional } from 'sequelize';
import sequelize from '../config/db';
import bcrypt from 'bcryptjs';
import {
  ACCOUNT_STATUSES,
  PROVISIONING_SOURCES,
  USER_ROLES,
  type AccountStatus,
  type ProvisioningSource,
  type UserRole,
} from '../utils/adminConstants';

interface NotificationSettings {
  messages: boolean;
  groups: boolean;
  sounds: boolean;
  audio: boolean;
  images: boolean;
  videos: boolean;
  files: boolean;
  reactions: boolean;
  mentions: boolean;
  calls: boolean;
}

interface UserAttributes {
  id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  accountStatus: AccountStatus;
  team: string | null;
  department: string | null;
  sessionVersion: number;
  mustChangePassword: boolean;
  provisioningSource: ProvisioningSource;
  avatar: string | null;
  bio: string | null;
  lastSeen: 'everyone' | 'contacts' | 'nobody';
  profileVisibility: 'everyone' | 'contacts' | 'nobody';
  readReceipts: boolean;
  typingIndicators: boolean;
  notificationSettings: NotificationSettings;
  resetToken: string | null;
  resetTokenExpiry: Date | null;
  isOnline: boolean;
  lastActive: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface UserCreationAttributes extends Optional<
  UserAttributes,
  | 'id'
  | 'role'
  | 'accountStatus'
  | 'team'
  | 'department'
  | 'sessionVersion'
  | 'mustChangePassword'
  | 'provisioningSource'
  | 'avatar'
  | 'bio'
  | 'lastSeen'
  | 'profileVisibility'
  | 'readReceipts'
  | 'typingIndicators'
  | 'notificationSettings'
  | 'resetToken'
  | 'resetTokenExpiry'
  | 'isOnline'
  | 'lastActive'
> {}

class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  declare id: string;
  declare name: string;
  declare email: string;
  declare password: string;
  declare role: UserRole;
  declare accountStatus: AccountStatus;
  declare team: string | null;
  declare department: string | null;
  declare sessionVersion: number;
  declare mustChangePassword: boolean;
  declare provisioningSource: ProvisioningSource;
  declare avatar: string | null;
  declare bio: string | null;
  declare lastSeen: 'everyone' | 'contacts' | 'nobody';
  declare profileVisibility: 'everyone' | 'contacts' | 'nobody';
  declare readReceipts: boolean;
  declare typingIndicators: boolean;
  declare notificationSettings: NotificationSettings;
  declare resetToken: string | null;
  declare resetTokenExpiry: Date | null;
  declare isOnline: boolean;
  declare lastActive: Date;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  async comparePassword(candidatePassword: string): Promise<boolean> {
    return bcrypt.compare(candidatePassword, this.password);
  }

  override toJSON(): Omit<UserAttributes, 'password' | 'resetToken' | 'resetTokenExpiry'> {
    const values = { ...this.get() };
    delete (values as any).password;
    delete (values as any).resetToken;
    delete (values as any).resetTokenExpiry;
    return values as Omit<UserAttributes, 'password' | 'resetToken' | 'resetTokenExpiry'>;
  }
}

User.init(
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
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM(...USER_ROLES),
      allowNull: false,
      defaultValue: 'member',
    },
    accountStatus: {
      type: DataTypes.ENUM(...ACCOUNT_STATUSES),
      allowNull: false,
      defaultValue: 'active',
    },
    team: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    department: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    sessionVersion: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    mustChangePassword: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    provisioningSource: {
      type: DataTypes.ENUM(...PROVISIONING_SOURCES),
      allowNull: false,
      defaultValue: 'self_signup',
    },
    avatar: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    bio: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    lastSeen: {
      type: DataTypes.ENUM('everyone', 'contacts', 'nobody'),
      defaultValue: 'everyone',
    },
    profileVisibility: {
      type: DataTypes.ENUM('everyone', 'contacts', 'nobody'),
      defaultValue: 'everyone',
    },
    readReceipts: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    typingIndicators: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    notificationSettings: {
      type: DataTypes.JSON,
      defaultValue: {
        messages: true,
        groups: true,
        sounds: true,
        audio: true,
        images: true,
        videos: true,
        files: true,
        reactions: true,
        mentions: true,
        calls: true,
      },
    },
    resetToken: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    resetTokenExpiry: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    isOnline: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    lastActive: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'users',
    timestamps: true,
    hooks: {
      beforeCreate: async (user: User) => {
        if (user.password) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      },
      beforeUpdate: async (user: User) => {
        if (user.changed('password')) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      },
    },
  }
);

export default User;
