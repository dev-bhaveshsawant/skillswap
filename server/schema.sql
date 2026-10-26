CREATE DATABASE IF NOT EXISTS skillswap CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE skillswap;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  full_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  credits INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  bio VARCHAR(1000) NOT NULL DEFAULT '',
  role VARCHAR(100) NOT NULL DEFAULT '',
  goal VARCHAR(100) NOT NULL DEFAULT '',
  availability TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS skills (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  kind ENUM('teach','learn') NOT NULL,
  level VARCHAR(30) NOT NULL DEFAULT 'Intermediate',
  target_level VARCHAR(30) NOT NULL DEFAULT 'Intermediate',
  experience VARCHAR(255) NOT NULL DEFAULT '',
  goal VARCHAR(100) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_skill (user_id, name, kind),
  KEY ix_skill_match (kind, name),
  CONSTRAINT fk_skills_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exchange_requests (
  id CHAR(36) NOT NULL PRIMARY KEY,
  requester_id BIGINT UNSIGNED NOT NULL,
  recipient_id BIGINT UNSIGNED NOT NULL,
  offered_skill VARCHAR(100) NOT NULL,
  wanted_skill VARCHAR(100) NOT NULL,
  match_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('Pending','Accepted','Rejected','Cancelled','Completed') NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_requests_requester (requester_id, status),
  KEY ix_requests_recipient (recipient_id, status),
  CONSTRAINT fk_requests_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_requests_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  request_id CHAR(36) NOT NULL UNIQUE,
  meeting_id VARCHAR(100) NULL,
  mode ENUM('Online Video Exchange','Offline') NOT NULL DEFAULT 'Online Video Exchange',
  starts_at DATETIME NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  note VARCHAR(1000) NOT NULL DEFAULT '',
  status ENUM('Scheduled','Completed','Cancelled') NOT NULL DEFAULT 'Scheduled',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_request FOREIGN KEY (request_id) REFERENCES exchange_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feedback (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id CHAR(36) NOT NULL,
  reviewer_id BIGINT UNSIGNED NOT NULL,
  reviewee_id BIGINT UNSIGNED NOT NULL,
  teaching TINYINT UNSIGNED NOT NULL,
  learning TINYINT UNSIGNED NOT NULL,
  communication TINYINT UNSIGNED NOT NULL,
  overall TINYINT UNSIGNED NOT NULL,
  comment VARCHAR(2000) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_session_reviewer (session_id, reviewer_id),
  CONSTRAINT fk_feedback_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_feedback_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_feedback_reviewee FOREIGN KEY (reviewee_id) REFERENCES users(id) ON DELETE CASCADE
);
