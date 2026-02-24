const fs = require('fs');
const path = require('path');

const swaggerPath = path.join(process.cwd(), 'swagger.json');
const swagger = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));

// Media Response schema definition
const mediaResponse = {
  "get": {
    "tags": ["Messages"],
    "summary": "Get chat media (images/voicenotes)",
    "description": "Fetch media messages (messages containing attachments or audio) for this chat.",
    "security": [{ "bearerAuth": [] }],
    "parameters": [
      {
        "name": "page",
        "in": "query",
        "schema": { "type": "integer", "default": 1 }
      },
      {
        "name": "limit",
        "in": "query",
        "schema": { "type": "integer", "default": 50 }
      }
    ],
    "responses": {
      "200": {
        "description": "Media fetched successfully",
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "media": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": { "type": "string" },
                      "sender": {
                        "type": "object",
                        "properties": {
                          "id": { "type": "string" },
                          "name": { "type": "string" },
                          "avatar": { "type": "string" }
                        }
                      },
                      "time": { "type": "string", "format": "date-time" },
                      "attachments": {
                        "type": "array",
                        "items": { "type": "string" }
                      },
                      "audio": {
                        "type": "object",
                        "properties": {
                          "url": { "type": "string" },
                          "duration": { "type": "string" }
                        }
                      }
                    }
                  }
                },
                "pagination": {
                  "type": "object",
                  "properties": {
                    "total": { "type": "integer" },
                    "page": { "type": "integer" },
                    "limit": { "type": "integer" },
                    "hasMore": { "type": "boolean" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

// Add /channels/{channelId}/media
const channelMediaDef = JSON.parse(JSON.stringify(mediaResponse));
channelMediaDef.get.tags = ["Channels"];
channelMediaDef.get.parameters.unshift({
  "name": "channelId",
  "in": "path",
  "required": true,
  "schema": { "type": "string", "format": "uuid" },
  "description": "Channel ID"
});

// Add /dms/{recipientId}/media
const dmMediaDef = JSON.parse(JSON.stringify(mediaResponse));
dmMediaDef.get.tags = ["Direct Messages"];
dmMediaDef.get.parameters.unshift({
  "name": "recipientId",
  "in": "path",
  "required": true,
  "schema": { "type": "string", "format": "uuid" },
  "description": "Recipient User ID"
});

// Insert them into paths
if (!swagger.paths['/channels/{channelId}/media']) {
  swagger.paths['/channels/{channelId}/media'] = channelMediaDef;
}

if (!swagger.paths['/dms/{recipientId}/media']) {
  swagger.paths['/dms/{recipientId}/media'] = dmMediaDef;
}

fs.writeFileSync(swaggerPath, JSON.stringify(swagger, null, 2));
console.log('Swagger updated successfully!');
