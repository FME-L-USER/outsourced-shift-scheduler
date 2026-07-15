-- ============================================================
-- 委外人力排班作業平台 — Cloud SQL PostgreSQL Schema
-- 版本：v1.0  日期：2026-07-15
-- 適用：Google Cloud SQL PostgreSQL 14+
-- 執行帳號：建議使用專屬 service account，不使用 root
-- ============================================================

-- ── 建立專用 schema ─────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS sms;
SET search_path = sms;

-- ── 啟用 UUID 擴充（Cloud SQL 預設已內建） ──────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. 廠商主檔  vendors
-- ============================================================
CREATE TABLE vendors (
    id            VARCHAR(20)  PRIMARY KEY,          -- e.g. 'vd_cs'
    code          VARCHAR(10)  NOT NULL UNIQUE,       -- e.g. 'CS'
    name          VARCHAR(50)  NOT NULL UNIQUE,       -- e.g. '承杺'
    company_name  VARCHAR(100),                       -- 廠商全名
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  vendors              IS '委外廠商主檔';
COMMENT ON COLUMN vendors.code         IS '廠商代碼，英文 2-3 碼';
COMMENT ON COLUMN vendors.name         IS '廠商簡稱';
COMMENT ON COLUMN vendors.company_name IS '廠商全名（用於報表顯示）';

-- ============================================================
-- 2. 倉別主檔  warehouses
-- ============================================================
CREATE TABLE warehouses (
    id          VARCHAR(20)  PRIMARY KEY,   -- e.g. 'wh1'
    name        VARCHAR(50)  NOT NULL,      -- e.g. '大溪倉'
    sort_order  SMALLINT     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE warehouses IS '倉別（大溪倉、大肚倉、岡山倉…）';

-- ============================================================
-- 3. 課別  departments
-- ============================================================
CREATE TABLE departments (
    id            VARCHAR(30)  PRIMARY KEY,          -- e.g. 'dept_wh1_1'
    warehouse_id  VARCHAR(20)  NOT NULL
                    REFERENCES warehouses(id) ON DELETE CASCADE,
    code          VARCHAR(10)  NOT NULL,             -- e.g. 'L027'
    name          VARCHAR(50)  NOT NULL,             -- e.g. '大溪理貨一課'
    sort_order    SMALLINT     NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (warehouse_id, code)
);

COMMENT ON TABLE  departments       IS '課別（隸屬倉別）';
COMMENT ON COLUMN departments.code  IS '課別代號，對應 ERP 科目代碼';

-- ============================================================
-- 4. 組別  groups
-- ============================================================
CREATE TABLE groups (
    id             SERIAL       PRIMARY KEY,
    department_id  VARCHAR(30)  NOT NULL
                     REFERENCES departments(id) ON DELETE CASCADE,
    name           VARCHAR(50)  NOT NULL,   -- e.g. '日班-理貨一組'
    sort_order     SMALLINT     NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (department_id, name)
);

COMMENT ON TABLE groups IS '組別（隸屬課別），如日班-理貨一組';

-- ============================================================
-- 5. 課別廠商關聯  department_vendors
--    記錄哪個廠商負責哪個課別
-- ============================================================
CREATE TABLE department_vendors (
    department_id  VARCHAR(30)  NOT NULL
                     REFERENCES departments(id) ON DELETE CASCADE,
    vendor_id      VARCHAR(20)  NOT NULL
                     REFERENCES vendors(id)     ON DELETE CASCADE,
    PRIMARY KEY (department_id, vendor_id)
);

-- ============================================================
-- 6. 系統帳號  users
-- ============================================================
CREATE TABLE users (
    id                   VARCHAR(20)   PRIMARY KEY,
    username             VARCHAR(50)   NOT NULL UNIQUE,
    password_hash        VARCHAR(200)  NOT NULL,  -- 'sha256:...'
    role                 VARCHAR(10)   NOT NULL
                           CHECK (role IN ('admin','area','vendor','worker')),
    display_name         VARCHAR(50)   NOT NULL,
    is_system            BOOLEAN       NOT NULL DEFAULT FALSE,  -- 系統保護帳號
    is_approved          BOOLEAN       NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN       NOT NULL DEFAULT TRUE,
    login_count          INT           NOT NULL DEFAULT 0,
    last_login_at        TIMESTAMPTZ,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  users                       IS '系統登入帳號（日翊員工 + 廠商幹部）';
COMMENT ON COLUMN users.role                  IS 'admin=管理員 area=當區幹部 vendor=廠商幹部 worker=委外人員';
COMMENT ON COLUMN users.is_system             IS 'TRUE=系統保護帳號，不可刪除或停用';
COMMENT ON COLUMN users.must_change_password  IS '首次登入強制改密碼旗標';

-- ============================================================
-- 7. 帳號可管理倉別  user_warehouses
-- ============================================================
CREATE TABLE user_warehouses (
    user_id       VARCHAR(20)  NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
    warehouse_id  VARCHAR(20)  NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, warehouse_id)
);

COMMENT ON TABLE user_warehouses IS 'AREA 角色的倉別授權清單；ADMIN 不需設定（全開）';

-- ============================================================
-- 8. 帳號可管理廠商  user_vendors
-- ============================================================
CREATE TABLE user_vendors (
    user_id    VARCHAR(20)  NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    vendor_id  VARCHAR(20)  NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, vendor_id)
);

COMMENT ON TABLE user_vendors IS 'VENDOR 角色的廠商授權清單';

-- ============================================================
-- 9. 委外員工主檔  employees
-- ============================================================
CREATE TABLE employees (
    id          VARCHAR(20)   PRIMARY KEY,   -- e.g. 'e1'
    emp_id      VARCHAR(20)   NOT NULL UNIQUE, -- 員工編號，登入帳號用
    name        VARCHAR(50)   NOT NULL,
    vendor_id   VARCHAR(20)   REFERENCES vendors(id) ON DELETE SET NULL,
    dept_name   VARCHAR(50),                 -- 所屬課別名稱（冗餘欄，方便查詢）
    group_name  VARCHAR(50),                 -- 所屬組別名稱
    status      VARCHAR(10)   NOT NULL DEFAULT '在職'
                  CHECK (status IN ('在職','離職','留用')),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  employees          IS '委外人員主檔；emp_id 同時為登入帳號';
COMMENT ON COLUMN employees.emp_id   IS '員工編號，格式如 CS001；首次登入密碼同員編';
COMMENT ON COLUMN employees.status   IS '在職 / 離職 / 留用';

-- ============================================================
-- 10. 委外人員自訂密碼  worker_passwords
--     首次登入後強制修改，hash 存此表
-- ============================================================
CREATE TABLE worker_passwords (
    emp_id        VARCHAR(20)   PRIMARY KEY
                    REFERENCES employees(emp_id) ON DELETE CASCADE,
    password_hash VARCHAR(200)  NOT NULL,  -- 'sha256:...'
    changed_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE worker_passwords IS '委外人員修改後的密碼 hash（首次登入前此表無紀錄，驗密用員編）';

-- ============================================================
-- 11. 班表  schedules
-- ============================================================
CREATE TABLE schedules (
    id           BIGSERIAL    PRIMARY KEY,
    employee_id  VARCHAR(20)  NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    work_date    DATE         NOT NULL,
    shift_code   VARCHAR(10)  NOT NULL DEFAULT 'V',  -- V/國/例/休/加/病/事/曠
    year         SMALLINT     GENERATED ALWAYS AS (EXTRACT(YEAR  FROM work_date)::SMALLINT) STORED,
    month        SMALLINT     GENERATED ALWAYS AS (EXTRACT(MONTH FROM work_date)::SMALLINT) STORED,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, work_date)
);

CREATE INDEX idx_schedules_date       ON schedules (work_date);
CREATE INDEX idx_schedules_emp_year_m ON schedules (employee_id, year, month);

COMMENT ON TABLE  schedules            IS '員工班表；一人一天一筆';
COMMENT ON COLUMN schedules.shift_code IS 'V=上班 國=國定假日 例=例假 休=休假 加=加班 病=病假 事=事假 曠=曠職';

-- ============================================================
-- 12. 點名記錄  attendance
--     記錄正式員工每日出勤
-- ============================================================
CREATE TABLE attendance (
    id           BIGSERIAL    PRIMARY KEY,
    employee_id  VARCHAR(20)  NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    attend_date  DATE         NOT NULL,
    is_present   BOOLEAN      NOT NULL DEFAULT FALSE,
    note         TEXT,
    recorded_by  VARCHAR(20)  REFERENCES users(id) ON DELETE SET NULL,
    recorded_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, attend_date)
);

CREATE INDEX idx_attendance_date ON attendance (attend_date);

COMMENT ON TABLE attendance IS '正式委外員工每日點名記錄；預設 FALSE（未到）';

-- ============================================================
-- 13. 臨時人力點名  attendance_extras
--     班表外臨時調度的人員，不在 employees 表內
-- ============================================================
CREATE TABLE attendance_extras (
    id           BIGSERIAL    PRIMARY KEY,
    attend_date  DATE         NOT NULL,
    name         VARCHAR(50)  NOT NULL,
    vendor_id    VARCHAR(20)  REFERENCES vendors(id) ON DELETE SET NULL,
    group_name   VARCHAR(50),
    is_present   BOOLEAN      NOT NULL DEFAULT FALSE,
    note         TEXT,
    recorded_by  VARCHAR(20)  REFERENCES users(id) ON DELETE SET NULL,
    recorded_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_extras_date ON attendance_extras (attend_date);

COMMENT ON TABLE attendance_extras IS '臨時人力點名（非正式員工，每日手動新增）';

-- ============================================================
-- 14. 排班區間設定  schedule_ranges
-- ============================================================
CREATE TABLE schedule_ranges (
    id          SERIAL       PRIMARY KEY,
    year        SMALLINT     NOT NULL,
    month       SMALLINT     NOT NULL CHECK (month BETWEEN 1 AND 12),
    start_date  DATE         NOT NULL,
    end_date    DATE         NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (year, month)
);

COMMENT ON TABLE schedule_ranges IS '每月排班有效區間設定（前端 scheduleRange）';

-- ============================================================
-- 15. 假日設定  holidays
-- ============================================================
CREATE TABLE holidays (
    holiday_date  DATE     PRIMARY KEY,
    label         VARCHAR(30),   -- e.g. '元旦'
    is_open       BOOLEAN  NOT NULL DEFAULT FALSE,  -- 開倉=TRUE
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  holidays          IS '國定假日 / 開倉日設定';
COMMENT ON COLUMN holidays.is_open  IS 'TRUE=開倉出勤（原本假日但需上班）';

-- ============================================================
-- 16. 班別代號表  shift_code_definitions
-- ============================================================
CREATE TABLE shift_code_definitions (
    code        VARCHAR(10)  PRIMARY KEY,
    label       VARCHAR(20)  NOT NULL,
    color_class VARCHAR(60),           -- Tailwind class，前端用
    meaning     VARCHAR(30),
    sort_order  SMALLINT     NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE shift_code_definitions IS '班別代號對照表（可由前端匯入 Excel 更新）';

-- ============================================================
-- 17. 系統設定  system_settings  （key-value）
-- ============================================================
CREATE TABLE system_settings (
    key         VARCHAR(50)  PRIMARY KEY,
    value       TEXT,
    updated_by  VARCHAR(20)  REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE system_settings IS '全域系統設定（系統鎖定、廠商假日開關等）';

-- ============================================================
-- 18. 登入稽核日誌  audit_logins
-- ============================================================
CREATE TABLE audit_logins (
    id          BIGSERIAL    PRIMARY KEY,
    username    VARCHAR(50)  NOT NULL,
    role        VARCHAR(10),
    ip_address  VARCHAR(45),
    success     BOOLEAN      NOT NULL,
    fail_reason VARCHAR(100),
    logged_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logins_user ON audit_logins (username, logged_at DESC);

COMMENT ON TABLE audit_logins IS '登入成功/失敗稽核日誌，保留 90 天';

-- ============================================================
-- TRIGGERS：自動更新 updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION sms.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'vendors','warehouses','departments','users',
        'employees','schedules','attendance','attendance_extras'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%s_updated_at
             BEFORE UPDATE ON sms.%s
             FOR EACH ROW EXECUTE FUNCTION sms.set_updated_at()',
            tbl, tbl
        );
    END LOOP;
END;
$$;

-- ============================================================
-- SEED DATA：廠商
-- ============================================================
INSERT INTO vendors (id, code, name, company_name) VALUES
  ('vd_cs', 'CS', '承杺',  '承杺人力資源有限公司'),
  ('vd_ct', 'CT', '芊通',  '芊通企業管理顧問有限公司'),
  ('vd_cy', 'CY', '承奕',  '承奕企業管理顧問有限公司'),
  ('vd_df', 'DF', '頂富',  '頂富企業管理顧問有限公司'),
  ('vd_ht', 'HT', '華煬通','華煬通企業管理顧問有限公司'),
  ('vd_sy', 'SY', '三彥',  '三彥企業管理顧問有限公司'),
  ('vd_wy', 'WY', '萬宜',  '萬宜企業管理顧問有限公司'),
  ('vd_xb', 'XB', '信邦',  '信邦管理顧問有限公司')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- SEED DATA：倉別 + 課別 + 組別
-- ============================================================
INSERT INTO warehouses (id, name, sort_order) VALUES
  ('wh1', '大溪倉', 1),
  ('wh2', '大肚倉', 2),
  ('wh3', '岡山倉', 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO departments (id, warehouse_id, code, name, sort_order) VALUES
  ('dept_wh1_1', 'wh1', 'L027', '大溪理貨一課', 1),
  ('dept_wh1_2', 'wh1', 'L022', '大溪理貨二課', 2),
  ('dept_wh1_3', 'wh1', 'L021', '倉儲管理課',   3),
  ('dept_wh1_4', 'wh1', 'L025', '運務課',       4),
  ('dept_wh1_5', 'wh1', 'L012', '營運指導課',   5),
  ('dept_wh2_1', 'wh2', 'L035', '大肚理貨課',   1),
  ('dept_wh2_2', 'wh2', 'L037', '大肚運務課',   2),
  ('dept_wh3_1', 'wh3', 'L007', '岡山營運課',   1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO groups (department_id, name, sort_order) VALUES
  -- 大溪理貨一課
  ('dept_wh1_1','日班-理貨一組',1), ('dept_wh1_1','日班-理貨二組',2),
  ('dept_wh1_1','事務組',       3), ('dept_wh1_1','中班-理貨一組',4),
  ('dept_wh1_1','中班-理貨二組',5), ('dept_wh1_1','日班-驗收組',  6),
  ('dept_wh1_1','夜班-驗收組',  7), ('dept_wh1_1','中班-驗收組',  8),
  ('dept_wh1_1','日班-EC廠退組',9),
  -- 大溪理貨二課
  ('dept_wh1_2','日班-店訂組',1), ('dept_wh1_2','日班-退貨組',2),
  ('dept_wh1_2','中班-分揀組',3), ('dept_wh1_2','日班-加工組',4),
  ('dept_wh1_2','日班-POP組', 5), ('dept_wh1_2','事務組',     6),
  -- 倉儲管理課
  ('dept_wh1_3','日班-庫存組',1), ('dept_wh1_3','日班-廠退組',2),
  ('dept_wh1_3','日班-收發組',3), ('dept_wh1_3','日班-O2O組', 4),
  ('dept_wh1_3','清潔組',     5), ('dept_wh1_3','事務組',     6),
  ('dept_wh1_3','日班-出貨組',7), ('dept_wh1_3','中班-庫存組',8),
  ('dept_wh1_3','夜班-O2O組', 9),
  -- 運務課
  ('dept_wh1_4','運務組',1),
  -- 營運指導課
  ('dept_wh1_5','事務組',1),
  -- 大肚理貨課
  ('dept_wh2_1','日班-理貨組',1), ('dept_wh2_1','中班-理貨組',2),
  ('dept_wh2_1','夜班-理貨組',3), ('dept_wh2_1','事務組',     4),
  ('dept_wh2_1','清潔組',     5), ('dept_wh2_1','日班-出貨組',6),
  -- 大肚運務課
  ('dept_wh2_2','運務組',1),
  -- 岡山營運課
  ('dept_wh3_1','日班-理貨組',1), ('dept_wh3_1','中班-理貨組',2),
  ('dept_wh3_1','夜班-理貨組',3), ('dept_wh3_1','日班-庫存組',4),
  ('dept_wh3_1','日班-出貨組',5), ('dept_wh3_1','日班-收發組',6),
  ('dept_wh3_1','清潔組',     7), ('dept_wh3_1','運務組',     8),
  ('dept_wh3_1','事務組',     9)
ON CONFLICT (department_id, name) DO NOTHING;

-- ============================================================
-- SEED DATA：班別代號
-- ============================================================
INSERT INTO shift_code_definitions (code, label, color_class, meaning, sort_order) VALUES
  ('V',  'V',  'bg-green-100 text-green-800',   '上班',   1),
  ('國', '國', 'bg-red-100 text-red-800',        '國定假日', 2),
  ('例', '例', 'bg-blue-100 text-blue-800',      '例假',   3),
  ('休', '休', 'bg-gray-100 text-gray-600',      '休假',   4),
  ('加', '加', 'bg-orange-100 text-orange-800',  '加班',   5),
  ('病', '病', 'bg-yellow-100 text-yellow-800',  '病假',   6),
  ('事', '事', 'bg-purple-100 text-purple-800',  '事假',   7),
  ('曠', '曠', 'bg-pink-100 text-pink-800',      '曠職',   8)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- SEED DATA：系統設定初始值
-- ============================================================
INSERT INTO system_settings (key, value) VALUES
  ('system_locked',       'false'),
  ('vendor_holiday_open', 'false')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- VIEW：每日出勤彙總（供報表查詢）
-- ============================================================
CREATE OR REPLACE VIEW v_daily_attendance_summary AS
SELECT
    a.attend_date,
    e.vendor_id,
    v.name        AS vendor_name,
    e.group_name,
    COUNT(*)      AS total,
    SUM(CASE WHEN a.is_present THEN 1 ELSE 0 END) AS present_count,
    SUM(CASE WHEN NOT a.is_present THEN 1 ELSE 0 END) AS absent_count
FROM attendance a
JOIN employees e ON a.employee_id = e.id
LEFT JOIN vendors v ON e.vendor_id = v.id
GROUP BY a.attend_date, e.vendor_id, v.name, e.group_name;

COMMENT ON VIEW v_daily_attendance_summary IS '每日廠商/組別出勤彙總';

-- ============================================================
-- 權限：建議由 IT 依實際 service account 設定
-- ============================================================
-- GRANT USAGE ON SCHEMA sms TO app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA sms TO app_user;
-- GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA sms TO app_user;
-- GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA sms TO app_user;

-- ============================================================
-- 結束
-- ============================================================
