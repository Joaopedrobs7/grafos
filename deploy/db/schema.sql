-- [IA] Claude – banco do histórico de consultas da aplicação web (Exercício 05 de Cloud: RDS MySQL)
-- Rodar no DBeaver conectado como admin (Execute script: Alt+X). Troque a senha do usuário da
-- aplicação antes de rodar; a mesma senha vai em /etc/labirinto/db.env na EC2.

-- ===================== DDL =====================
CREATE DATABASE IF NOT EXISTS labirinto;
USE labirinto;

DROP TABLE IF EXISTS execucao;
DROP TABLE IF EXISTS mapa;        -- tabela de uma versão anterior deste script
DROP TABLE IF EXISTS algoritmo;

CREATE TABLE algoritmo (
  codigo    VARCHAR(20)  PRIMARY KEY,                -- mesmo código usado pela aplicação
  nome      VARCHAR(40)  NOT NULL,
  descricao VARCHAR(255) NOT NULL
);

CREATE TABLE execucao (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  mapa      VARCHAR(40) NOT NULL,                    -- nome do arquivo em data/, sem .txt
  algoritmo VARCHAR(20) NOT NULL,
  status    VARCHAR(20) NOT NULL,                    -- OK, RECUSA, CICLO_NEGATIVO, SEM_SOLUCAO
  passos    INT    NULL,
  custo     DOUBLE NULL,
  instancia VARCHAR(40) NOT NULL,                    -- instância do ASG que atendeu
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_execucao_algoritmo FOREIGN KEY (algoritmo) REFERENCES algoritmo(codigo)
);

-- ===================== DML =====================
INSERT INTO algoritmo (codigo, nome, descricao) VALUES
  ('BFS',          'BFS',          'Menor número de passos até a saída'),
  ('DIJKSTRA',     'Dijkstra',     'Menor custo; recusa grafos com peso negativo'),
  ('BELLMAN_FORD', 'Bellman-Ford', 'Menor custo com pesos negativos; detecta ciclo negativo');

-- ============ Usuário da aplicação (menor privilégio) ============
CREATE USER IF NOT EXISTS 'labirinto_app'@'%' IDENTIFIED BY 'TROQUE_ESTA_SENHA';
GRANT SELECT         ON labirinto.algoritmo TO 'labirinto_app'@'%';
GRANT SELECT, INSERT ON labirinto.execucao  TO 'labirinto_app'@'%';

-- ============ Conferência (prints do relatório) ============
SELECT * FROM algoritmo;
SHOW GRANTS FOR 'labirinto_app'@'%';
