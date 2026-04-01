-- Atomic answer recording Lua script
-- KEYS[1] = ROUND:{roundId}:ANSWERS  (Redis Set)
-- KEYS[2] = ROUND:{roundId}:DIST     (Redis Hash)
-- ARGV[1] = userId
-- ARGV[2] = option (A|B|C|D)
-- Returns: 1 = recorded, 0 = duplicate

local isDup = redis.call('SISMEMBER', KEYS[1], ARGV[1])
if isDup == 1 then
  return 0
end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('HINCRBY', KEYS[2], ARGV[2], 1)
return 1
