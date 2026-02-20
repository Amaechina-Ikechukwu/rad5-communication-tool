import User from './User';
import Channel from './Channel';
import ChannelMember from './ChannelMember';
import DirectMessage from './DirectMessage';
import DirectMessageMember from './DirectMessageMember';
import Message from './Message';
import Reaction from './Reaction';

// User - Channel relationships (many-to-many through ChannelMember)
User.belongsToMany(Channel, {
  through: ChannelMember,
  foreignKey: 'userId',
  otherKey: 'channelId',
  as: 'channels',
});

Channel.belongsToMany(User, {
  through: ChannelMember,
  foreignKey: 'channelId',
  otherKey: 'userId',
  as: 'members',
});

// Channel creator
Channel.belongsTo(User, {
  foreignKey: 'createdBy',
  as: 'creator',
});

// ChannelMember relationships
ChannelMember.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

ChannelMember.belongsTo(Channel, {
  foreignKey: 'channelId',
  as: 'channel',
});

// User - DirectMessage relationships (many-to-many through DirectMessageMember)
User.belongsToMany(DirectMessage, {
  through: DirectMessageMember,
  foreignKey: 'userId',
  otherKey: 'dmId',
  as: 'directMessages',
});

DirectMessage.belongsToMany(User, {
  through: DirectMessageMember,
  foreignKey: 'dmId',
  otherKey: 'userId',
  as: 'participants',
});

// DirectMessage creator
DirectMessage.belongsTo(User, {
  foreignKey: 'createdBy',
  as: 'creator',
});

// DirectMessageMember relationships
DirectMessageMember.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

DirectMessageMember.belongsTo(DirectMessage, {
  foreignKey: 'dmId',
  as: 'directMessage',
});

// Message relationships
Message.belongsTo(User, {
  foreignKey: 'senderId',
  as: 'sender',
});

Message.belongsTo(Channel, {
  foreignKey: 'channelId',
  as: 'channel',
});

Channel.hasMany(Message, {
  foreignKey: 'channelId',
  as: 'messages',
});

Message.belongsTo(DirectMessage, {
  foreignKey: 'dmId',
  as: 'directMessage',
});

DirectMessage.hasMany(Message, {
  foreignKey: 'dmId',
  as: 'messages',
});

// Reaction relationships
Reaction.belongsTo(Message, {
  foreignKey: 'messageId',
  as: 'message',
});

Reaction.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

Message.hasMany(Reaction, {
  foreignKey: 'messageId',
  as: 'reactions',
});

export { User, Channel, ChannelMember, DirectMessage, DirectMessageMember, Message, Reaction };
