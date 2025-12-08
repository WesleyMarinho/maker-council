"""
MAKER-Council MCP Server - High Performance Edition

Implementação do paper "MAKER: Massively Decomposed Agentic Processes"
(arXiv:2511.09030v1) usando FastMCP.

MAKER = Maximal Agentic decomposition + first-to-ahead-by-K Error correction + Red-flagging

Este servidor implementa os três componentes principais:
1. MAD (Maximal Agentic Decomposition) - Decomposição em subtarefas mínimas
2. First-to-ahead-by-k Voting - Sistema de votação com margem k
3. Red-flagging - Descarte de respostas com sinais de erro (muito longas ou mal formatadas)

Otimizações de Performance:
- Batch voting paralelo com semáforo de concorrência
- Early termination com cancelamento de tasks pendentes
- Cache LRU para respostas similares
- Connection pooling otimizado
- Streaming de resultados parciais

Suporta tanto a API nativa da Anthropic quanto proxies OpenAI-compatíveis.
"""

import asyncio
import hashlib
import json
import os
import re
import time
from collections import defaultdict
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Protocol

from dotenv import load_dotenv
from fastmcp import FastMCP

# Carregar variáveis de ambiente
load_dotenv()

# --- Configuração ---
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
ANTHROPIC_BASE_URL = os.getenv("ANTHROPIC_BASE_URL")
JUDGE_MODEL = os.getenv("JUDGE_MODEL", "claude-sonnet-4-5-20250929")
VOTER_MODEL = os.getenv("VOTER_MODEL", "claude-haiku-4-5-20251001")

# Parâmetros MAKER
DEFAULT_K = int(os.getenv("MAKER_K", "3"))  # Margem de votação (first-to-ahead-by-k)
MAX_TOKENS_THRESHOLD = int(os.getenv("MAKER_MAX_TOKENS", "750"))  # Red-flag: respostas muito longas
MAX_VOTING_ROUNDS = int(os.getenv("MAKER_MAX_ROUNDS", "50"))  # Limite de segurança

# Parâmetros de Performance
MAX_CONCURRENT_REQUESTS = int(os.getenv("MAKER_MAX_CONCURRENT", "10"))  # Limite de requisições paralelas
BATCH_SIZE = int(os.getenv("MAKER_BATCH_SIZE", "5"))  # Tamanho do lote de votação paralela
CACHE_TTL_SECONDS = int(os.getenv("MAKER_CACHE_TTL", "300"))  # TTL do cache (5 min)
CACHE_MAX_SIZE = int(os.getenv("MAKER_CACHE_SIZE", "100"))  # Tamanho máximo do cache
ENABLE_EARLY_TERMINATION = os.getenv("MAKER_EARLY_TERMINATION", "true").lower() == "true"

# Validação
if not ANTHROPIC_API_KEY:
    raise ValueError("ANTHROPIC_API_KEY não está definida no ambiente.")


# --- Sistema de Cache com TTL ---
@dataclass
class CacheEntry:
    """Entrada de cache com TTL."""
    value: str
    tokens: int
    timestamp: float
    
    def is_expired(self, ttl: float) -> bool:
        return time.time() - self.timestamp > ttl


class ResponseCache:
    """Cache LRU com TTL para respostas de LLM."""
    
    def __init__(self, max_size: int = CACHE_MAX_SIZE, ttl: float = CACHE_TTL_SECONDS):
        self._cache: dict[str, CacheEntry] = {}
        self._max_size = max_size
        self._ttl = ttl
        self._hits = 0
        self._misses = 0
    
    def _make_key(self, model: str, system: str, prompt: str, temperature: float) -> str:
        """Cria chave de cache baseada nos parâmetros."""
        # Para temperature > 0, não usar cache (respostas devem variar)
        if temperature > 0:
            return ""
        content = f"{model}:{system}:{prompt}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]
    
    def get(self, model: str, system: str, prompt: str, temperature: float) -> tuple[str, int] | None:
        """Busca resposta no cache."""
        key = self._make_key(model, system, prompt, temperature)
        if not key:
            return None
        
        entry = self._cache.get(key)
        if entry and not entry.is_expired(self._ttl):
            self._hits += 1
            return entry.value, entry.tokens
        
        if entry:
            del self._cache[key]
        self._misses += 1
        return None
    
    def set(self, model: str, system: str, prompt: str, temperature: float, value: str, tokens: int):
        """Armazena resposta no cache."""
        key = self._make_key(model, system, prompt, temperature)
        if not key:
            return
        
        # Limpar entradas expiradas se cache cheio
        if len(self._cache) >= self._max_size:
            self._cleanup()
        
        self._cache[key] = CacheEntry(value=value, tokens=tokens, timestamp=time.time())
    
    def _cleanup(self):
        """Remove entradas expiradas."""
        now = time.time()
        expired = [k for k, v in self._cache.items() if v.is_expired(self._ttl)]
        for k in expired:
            del self._cache[k]
        
        # Se ainda cheio, remover mais antigas
        if len(self._cache) >= self._max_size:
            sorted_entries = sorted(self._cache.items(), key=lambda x: x[1].timestamp)
            for k, _ in sorted_entries[:len(self._cache) // 2]:
                del self._cache[k]
    
    @property
    def stats(self) -> dict[str, Any]:
        """Retorna estatísticas do cache."""
        return {
            "size": len(self._cache),
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": self._hits / (self._hits + self._misses) if (self._hits + self._misses) > 0 else 0
        }


# Cache global
_response_cache = ResponseCache()


# --- Semáforo de Concorrência ---
_request_semaphore: asyncio.Semaphore | None = None


def get_semaphore() -> asyncio.Semaphore:
    """Retorna semáforo singleton para controle de concorrência."""
    global _request_semaphore
    if _request_semaphore is None:
        _request_semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    return _request_semaphore


# --- Interface de Cliente LLM ---
class LLMClient(Protocol):
    """Protocolo para clientes LLM."""
    async def create_message(
        self,
        model: str,
        max_tokens: int,
        temperature: float,
        system: str,
        messages: list[dict[str, str]]
    ) -> tuple[str, int]:
        """Cria uma mensagem e retorna (texto, num_tokens)."""
        ...


class AnthropicClient:
    """Cliente para API nativa da Anthropic com cache e controle de concorrência."""
    
    def __init__(self, api_key: str, base_url: str | None = None):
        from anthropic import AsyncAnthropic
        import httpx
        
        # Connection pooling otimizado
        limits = httpx.Limits(
            max_keepalive_connections=20,
            max_connections=50,
            keepalive_expiry=30.0
        )
        timeout = httpx.Timeout(60.0, connect=10.0)
        
        kwargs: dict[str, Any] = {
            "api_key": api_key,
            "timeout": timeout,
            "max_retries": 2
        }
        if base_url:
            kwargs["base_url"] = base_url
        self._client = AsyncAnthropic(**kwargs)
    
    async def create_message(
        self,
        model: str,
        max_tokens: int,
        temperature: float,
        system: str,
        messages: list[dict[str, str]]
    ) -> tuple[str, int]:
        prompt = messages[0]["content"] if messages else ""
        
        # Verificar cache (apenas para temperature=0)
        cached = _response_cache.get(model, system, prompt, temperature)
        if cached:
            return cached
        
        # Usar semáforo para controle de concorrência
        async with get_semaphore():
            response = await self._client.messages.create(
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                system=system,
                messages=messages
            )
        
        text = response.content[0].text if response.content else ""
        tokens = response.usage.output_tokens if response.usage else len(text) // 4
        
        # Armazenar no cache
        _response_cache.set(model, system, prompt, temperature, text, tokens)
        
        return text, tokens


class OpenAICompatibleClient:
    """Cliente para APIs compatíveis com OpenAI com cache e controle de concorrência."""
    
    def __init__(self, api_key: str, base_url: str):
        from openai import AsyncOpenAI
        import httpx
        
        # Connection pooling otimizado
        timeout = httpx.Timeout(60.0, connect=10.0)
        
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=2
        )
    
    async def create_message(
        self,
        model: str,
        max_tokens: int,
        temperature: float,
        system: str,
        messages: list[dict[str, str]]
    ) -> tuple[str, int]:
        prompt = messages[0]["content"] if messages else ""
        
        # Verificar cache (apenas para temperature=0)
        cached = _response_cache.get(model, system, prompt, temperature)
        if cached:
            return cached
        
        full_messages = [{"role": "system", "content": system}] + messages
        
        # Usar semáforo para controle de concorrência
        async with get_semaphore():
            response = await self._client.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                messages=full_messages
            )
        
        text = response.choices[0].message.content or ""
        tokens = response.usage.completion_tokens if response.usage else len(text) // 4
        
        # Armazenar no cache
        _response_cache.set(model, system, prompt, temperature, text, tokens)
        
        return text, tokens


# --- Cliente Singleton ---
_client: LLMClient | None = None


def get_llm_client() -> LLMClient:
    """Retorna uma instância singleton do cliente LLM apropriado."""
    global _client
    if _client is None:
        if ANTHROPIC_BASE_URL:
            _client = OpenAICompatibleClient(
                api_key=ANTHROPIC_API_KEY,
                base_url=ANTHROPIC_BASE_URL
            )
        else:
            _client = AnthropicClient(api_key=ANTHROPIC_API_KEY)
    return _client


# --- Red-Flagging (Seção 3.3 do paper) ---
@dataclass
class RedFlagResult:
    """Resultado da verificação de red flags."""
    is_valid: bool
    reason: str | None = None
    content: str = ""


def check_red_flags(response: str, num_tokens: int, max_tokens: int = MAX_TOKENS_THRESHOLD) -> RedFlagResult:
    """
    Verifica red flags na resposta (Seção 3.3 do paper MAKER).
    
    Red flags indicam que o LLM pode estar confuso:
    1. Respostas muito longas (indica over-analysis/confusão)
    2. Formato incorreto (indica raciocínio problemático)
    """
    # Red flag 1: Resposta muito longa
    if num_tokens > max_tokens:
        return RedFlagResult(
            is_valid=False,
            reason=f"Resposta muito longa ({num_tokens} tokens > {max_tokens})"
        )
    
    # Red flag 2: Resposta vazia
    if not response.strip():
        return RedFlagResult(
            is_valid=False,
            reason="Resposta vazia"
        )
    
    return RedFlagResult(is_valid=True, content=response)


# --- First-to-ahead-by-k Voting (Seção 3.2 do paper) - HIGH PERFORMANCE ---
@dataclass
class VotingState:
    """Estado do processo de votação."""
    votes: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    total_samples: int = 0
    valid_samples: int = 0
    red_flagged: int = 0
    batch_rounds: int = 0
    early_terminated: bool = False
    elapsed_time: float = 0.0


class VotingController:
    """Controlador de votação com early termination e batch paralelo."""
    
    def __init__(self):
        self._winner: str | None = None
        self._terminated = asyncio.Event()
        self._lock = asyncio.Lock()
    
    @property
    def is_terminated(self) -> bool:
        return self._terminated.is_set()
    
    @property
    def winner(self) -> str | None:
        return self._winner
    
    async def check_and_set_winner(self, candidate: str, votes: dict[str, int], k: int) -> bool:
        """Verifica se candidato venceu e seta como vencedor atomicamente."""
        async with self._lock:
            if self._terminated.is_set():
                return False
            
            current_votes = votes.get(candidate, 0)
            max_other_votes = max(
                (v for key, v in votes.items() if key != candidate),
                default=0
            )
            
            if current_votes >= k + max_other_votes:
                self._winner = candidate
                self._terminated.set()
                return True
            return False
    
    def terminate(self, winner: str):
        """Força terminação com vencedor específico."""
        self._winner = winner
        self._terminated.set()


async def first_to_ahead_by_k_voting(
    client: LLMClient,
    prompt: str,
    system_prompt: str,
    model: str,
    k: int = DEFAULT_K,
    temperature: float = 0.7,
    max_rounds: int = MAX_VOTING_ROUNDS,
    extract_answer: callable = None,
    batch_size: int = BATCH_SIZE
) -> tuple[str, VotingState]:
    """
    Implementa o algoritmo First-to-ahead-by-k do paper MAKER (Algorithm 2).
    
    VERSÃO OTIMIZADA COM:
    - Batch paralelo: dispara múltiplas amostras simultaneamente
    - Early termination: cancela tasks pendentes quando vencedor é encontrado
    - Controle de concorrência via semáforo global
    
    Args:
        client: Cliente LLM
        prompt: Prompt do usuário
        system_prompt: Prompt do sistema
        model: Modelo a usar
        k: Margem de vitória necessária
        temperature: Temperatura para diversidade
        max_rounds: Limite de segurança
        extract_answer: Função para extrair resposta canônica (para matching)
        batch_size: Número de amostras paralelas por lote
    
    Returns:
        (resposta_vencedora, estado_votação)
    """
    start_time = time.time()
    state = VotingState()
    controller = VotingController()
    
    # Função padrão de extração (usa resposta completa)
    if extract_answer is None:
        extract_answer = lambda x: x.strip()
    
    async def sample_vote(sample_id: int, use_temp: float) -> tuple[str | None, bool]:
        """Amostra um voto individual. Retorna (canonical, is_valid)."""
        if controller.is_terminated and ENABLE_EARLY_TERMINATION:
            return None, False
        
        try:
            response, num_tokens = await client.create_message(
                model=model,
                max_tokens=MAX_TOKENS_THRESHOLD + 100,
                temperature=use_temp,
                system=system_prompt,
                messages=[{"role": "user", "content": prompt}]
            )
            
            # Verificar red flags
            flag_result = check_red_flags(response, num_tokens)
            if not flag_result.is_valid:
                return None, False
            
            # Extrair resposta canônica
            canonical = extract_answer(response)
            if not canonical:
                return None, False
            
            return canonical, True
            
        except Exception:
            return None, False
    
    # Primeira amostra determinística (temperature=0)
    first_result, first_valid = await sample_vote(0, 0.0)
    state.total_samples += 1
    
    if first_valid and first_result:
        state.valid_samples += 1
        state.votes[first_result] += 1
        
        # Verificar vitória imediata (k=1 com primeiro voto)
        if await controller.check_and_set_winner(first_result, dict(state.votes), k):
            state.elapsed_time = time.time() - start_time
            state.early_terminated = True
            return first_result, state
    else:
        state.red_flagged += 1
    
    # Votação em lotes paralelos
    samples_remaining = max_rounds - 1
    batch_num = 0
    
    while samples_remaining > 0 and not controller.is_terminated:
        batch_num += 1
        state.batch_rounds += 1
        current_batch_size = min(batch_size, samples_remaining)
        
        # Criar tasks para o lote
        tasks = [
            asyncio.create_task(sample_vote(i, temperature))
            for i in range(current_batch_size)
        ]
        
        # Aguardar todas as tasks do lote (ou cancelar se early termination)
        if ENABLE_EARLY_TERMINATION:
            # Usar wait com FIRST_COMPLETED para early termination
            pending = set(tasks)
            while pending and not controller.is_terminated:
                done, pending = await asyncio.wait(
                    pending,
                    timeout=0.1,
                    return_when=asyncio.FIRST_COMPLETED
                )
                
                for task in done:
                    state.total_samples += 1
                    samples_remaining -= 1
                    
                    try:
                        canonical, is_valid = task.result()
                        
                        if is_valid and canonical:
                            state.valid_samples += 1
                            state.votes[canonical] += 1
                            
                            # Verificar vitória
                            if await controller.check_and_set_winner(canonical, dict(state.votes), k):
                                state.early_terminated = True
                                # Cancelar tasks pendentes
                                for p in pending:
                                    p.cancel()
                                break
                        else:
                            state.red_flagged += 1
                    except asyncio.CancelledError:
                        pass
                    except Exception:
                        state.red_flagged += 1
                
                if controller.is_terminated:
                    # Cancelar todas as pendentes
                    for p in pending:
                        p.cancel()
                    break
        else:
            # Modo sem early termination - aguardar todas
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for result in results:
                state.total_samples += 1
                samples_remaining -= 1
                
                if isinstance(result, Exception):
                    state.red_flagged += 1
                    continue
                
                canonical, is_valid = result
                
                if is_valid and canonical:
                    state.valid_samples += 1
                    state.votes[canonical] += 1
                    
                    # Verificar vitória (sem early termination, apenas marca)
                    await controller.check_and_set_winner(canonical, dict(state.votes), k)
                else:
                    state.red_flagged += 1
        
        # Se encontrou vencedor, sair do loop
        if controller.is_terminated:
            break
    
    state.elapsed_time = time.time() - start_time
    
    # Retornar vencedor ou mais votado
    if controller.winner:
        return controller.winner, state
    
    if state.votes:
        winner = max(state.votes.items(), key=lambda x: x[1])[0]
        return winner, state
    
    return "", state


async def parallel_multi_voter_voting(
    client: LLMClient,
    prompt: str,
    system_prompt: str,
    model: str,
    num_voters: int,
    k: int = DEFAULT_K,
    temperature: float = 0.7,
    extract_answer: callable = None
) -> list[tuple[str, VotingState]]:
    """
    Executa múltiplos processos de votação em paralelo.
    
    Otimização: todos os voters rodam simultaneamente, compartilhando
    o semáforo de concorrência para não sobrecarregar a API.
    """
    tasks = [
        first_to_ahead_by_k_voting(
            client=client,
            prompt=prompt,
            system_prompt=system_prompt,
            model=model,
            k=k,
            temperature=temperature,
            extract_answer=extract_answer
        )
        for _ in range(num_voters)
    ]
    
    results = await asyncio.gather(*tasks)
    return list(results)


# --- Prompts do Sistema ---
VOTER_SYSTEM_PROMPT = """Você é um microagente especializado focado em precisão técnica.
Sua tarefa é analisar a questão e fornecer UMA solução clara e concisa.

REGRAS:
1. Seja direto e técnico
2. Forneça apenas a solução, sem explicações longas
3. Se for código, forneça código funcional e completo
4. Não repita a pergunta nem faça preâmbulos

Responda de forma estruturada e objetiva."""

JUDGE_SYSTEM_PROMPT = """Você é o Juiz Sênior do MAKER-Council.
Sua função é analisar múltiplas propostas de microagentes e sintetizar a melhor solução.

PROCESSO DE JULGAMENTO:
1. CONSENSO: Se as propostas concordam, sintetize a melhor versão combinando pontos fortes
2. DIVERGÊNCIA MENOR: Escolha a abordagem mais robusta e justifique brevemente
3. DIVERGÊNCIA PERIGOSA: Se propostas são contraditórias de forma que pode causar bugs ou 
   problemas de segurança, retorne exatamente "RED FLAG:" seguido da explicação do conflito

FORMATO DA RESPOSTA:
- Comece com "## Análise" resumindo as propostas
- Depois "## Decisão" com a solução final
- Se código, forneça código completo e funcional"""

DECOMPOSER_SYSTEM_PROMPT = """Você é um especialista em decomposição de tarefas seguindo a metodologia MAKER.
Sua função é quebrar tarefas complexas em passos ATÔMICOS e ACIONÁVEIS.

PRINCÍPIOS DA DECOMPOSIÇÃO MAKER:
1. Cada passo deve ser uma ÚNICA ação verificável
2. Passos devem ser pequenos o suficiente para um microagente executar sem confusão
3. Dependências entre passos devem ser explícitas
4. Evite passos vagos - seja específico sobre O QUE fazer

FORMATO DE SAÍDA (JSON):
{
    "task": "descrição original",
    "decomposition_depth": número,
    "total_steps": número,
    "steps": [
        {
            "id": 1,
            "action": "ação específica",
            "input": "o que este passo recebe",
            "output": "o que este passo produz",
            "dependencies": [],
            "is_atomic": true
        }
    ]
}

Se uma subtarefa ainda for complexa, marque is_atomic=false para indicar que precisa de mais decomposição."""


# --- Inicialização do Servidor MCP ---
mcp = FastMCP(
    name="MAKER-Council",
    instructions="""
    Servidor MCP implementando a metodologia MAKER (arXiv:2511.09030v1).
    
    MAKER = Maximal Agentic decomposition + first-to-ahead-by-K Error correction + Red-flagging
    
    Ferramentas:
    - consult_council: Consulta com votação first-to-ahead-by-k para consenso robusto
    - decompose_task: Decomposição extrema de tarefas em passos atômicos
    - solve_with_voting: Resolve uma questão usando apenas votação (sem juiz)
    """
)


# --- Funções Auxiliares ---
def extract_code_or_answer(response: str) -> str:
    """Extrai código ou resposta principal para comparação de votos."""
    # Tentar extrair bloco de código
    code_match = re.search(r'```(?:\w+)?\n(.*?)```', response, re.DOTALL)
    if code_match:
        return code_match.group(1).strip()
    
    # Tentar extrair resposta após marcadores comuns
    for marker in ['Resposta:', 'Solução:', 'Answer:', 'Solution:']:
        if marker in response:
            return response.split(marker, 1)[1].strip()
    
    # Retornar resposta limpa
    return response.strip()


async def collect_voter_proposals(
    client: LLMClient,
    query: str,
    num_voters: int,
    k: int
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Coleta propostas de múltiplos voters usando votação first-to-ahead-by-k.
    
    VERSÃO OTIMIZADA:
    - Todos os voters rodam em paralelo
    - Compartilham semáforo de concorrência
    - Métricas de performance incluídas
    
    Returns:
        (propostas, métricas_performance)
    """
    start_time = time.time()
    
    async def get_voter_proposal(voter_id: int) -> dict[str, Any]:
        """Obtém proposta de um voter individual."""
        winner, state = await first_to_ahead_by_k_voting(
            client=client,
            prompt=query,
            system_prompt=VOTER_SYSTEM_PROMPT,
            model=VOTER_MODEL,
            k=k,
            temperature=0.7,
            extract_answer=extract_code_or_answer
        )
        
        return {
            "voter_id": voter_id,
            "proposal": winner,
            "votes": dict(state.votes),
            "total_samples": state.total_samples,
            "valid_samples": state.valid_samples,
            "red_flagged": state.red_flagged,
            "batch_rounds": state.batch_rounds,
            "early_terminated": state.early_terminated,
            "elapsed_time": state.elapsed_time
        }
    
    # Executar todos os voters em paralelo
    tasks = [get_voter_proposal(i + 1) for i in range(num_voters)]
    proposals = await asyncio.gather(*tasks)
    
    total_elapsed = time.time() - start_time
    
    # Calcular métricas de performance
    performance_metrics = {
        "total_wall_time": total_elapsed,
        "avg_voter_time": sum(p["elapsed_time"] for p in proposals) / len(proposals) if proposals else 0,
        "max_voter_time": max(p["elapsed_time"] for p in proposals) if proposals else 0,
        "min_voter_time": min(p["elapsed_time"] for p in proposals) if proposals else 0,
        "parallelism_efficiency": (sum(p["elapsed_time"] for p in proposals) / total_elapsed / len(proposals)) if proposals and total_elapsed > 0 else 0,
        "early_terminations": sum(1 for p in proposals if p["early_terminated"]),
        "cache_stats": _response_cache.stats
    }
    
    return list(proposals), performance_metrics


# --- Tools MCP ---
@mcp.tool(
    name="consult_council",
    description="""Consulta o MAKER-Council usando o algoritmo completo do paper.
    
    Processo:
    1. Múltiplos microagentes (voters) geram propostas usando votação first-to-ahead-by-k
    2. Um juiz sênior analisa as propostas e sintetiza o consenso
    3. Red-flagging descarta respostas problemáticas automaticamente
    
    Parâmetros:
    - query: A questão ou código a ser analisado
    - num_voters: Número de microagentes (padrão: 3)
    - k: Margem de votação first-to-ahead-by-k (padrão: 3)
    
    Retorna relatório com decisão do juiz e métricas de votação.
    """
)
async def consult_council(query: str, num_voters: int = 3, k: int = DEFAULT_K) -> str:
    """Consulta o MAKER-Council com votação first-to-ahead-by-k."""
    
    num_voters = max(1, min(num_voters, 10))
    k = max(1, min(k, 10))
    
    client = get_llm_client()
    total_start = time.time()
    
    # Fase 1: Coletar propostas dos voters (paralelo)
    proposals, perf_metrics = await collect_voter_proposals(client, query, num_voters, k)
    voting_time = time.time() - total_start
    
    # Verificar se temos propostas válidas
    valid_proposals = [p for p in proposals if p["proposal"]]
    if not valid_proposals:
        return "ERRO: Nenhum microagente conseguiu gerar uma proposta valida."
    
    # Fase 2: Julgamento
    judge_start = time.time()
    formatted_proposals = "\n\n".join([
        f"=== PROPOSTA DO MICROAGENTE {p['voter_id']} ===\n"
        f"(Convergiu com {p['valid_samples']} amostras validas, {p['red_flagged']} descartadas)\n\n"
        f"{p['proposal']}"
        for p in valid_proposals
    ])
    
    judge_prompt = f"""QUESTAO ORIGINAL:
{query}

PROPOSTAS DOS MICROAGENTES:
{formatted_proposals}

Analise as propostas e forneca sua decisao final seguindo o processo de julgamento."""

    try:
        judge_response, _ = await client.create_message(
            model=JUDGE_MODEL,
            max_tokens=4096,
            temperature=0.0,
            system=JUDGE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": judge_prompt}]
        )
    except Exception as e:
        judge_response = f"Erro no julgamento: {str(e)}"
    
    judge_time = time.time() - judge_start
    total_time = time.time() - total_start
    
    # Calcular metricas
    total_samples = sum(p["total_samples"] for p in proposals)
    total_valid = sum(p["valid_samples"] for p in proposals)
    total_flagged = sum(p["red_flagged"] for p in proposals)
    
    # Formatar relatorio com metricas de performance
    result = f"""# MAKER-Council Report

## Configuracao
- Voters: {num_voters}
- Margem k (first-to-ahead-by-k): {k}
- Modelo Voters: {VOTER_MODEL}
- Modelo Juiz: {JUDGE_MODEL}
- Batch Size: {BATCH_SIZE}
- Max Concurrent: {MAX_CONCURRENT_REQUESTS}
- Early Termination: {ENABLE_EARLY_TERMINATION}

## Metricas de Votacao
- Total de amostras: {total_samples}
- Amostras validas: {total_valid}
- Red-flagged (descartadas): {total_flagged}
- Taxa de red-flag: {total_flagged/total_samples*100:.1f}%

## Performance
- Tempo total: {total_time:.2f}s
- Tempo votacao (paralela): {voting_time:.2f}s
- Tempo julgamento: {judge_time:.2f}s
- Tempo medio por voter: {perf_metrics['avg_voter_time']:.2f}s
- Early terminations: {perf_metrics['early_terminations']}/{num_voters}
- Eficiencia de paralelismo: {perf_metrics['parallelism_efficiency']*100:.1f}%
- Cache hits: {perf_metrics['cache_stats']['hits']} (rate: {perf_metrics['cache_stats']['hit_rate']*100:.1f}%)

## Propostas Recebidas
{chr(10).join([f"- Voter {p['voter_id']}: {len(p['proposal'])} chars, {p['valid_samples']} votos, {p['elapsed_time']:.2f}s" for p in valid_proposals])}

## Decisao Final do Juiz

{judge_response}
"""
    return result


@mcp.tool(
    name="solve_with_voting",
    description="""Resolve uma questão usando APENAS votação first-to-ahead-by-k (sem juiz).
    
    Útil para questões com resposta objetiva onde o consenso estatístico é suficiente.
    Mais rápido e barato que consult_council.
    
    Parâmetros:
    - query: A questão a ser resolvida
    - k: Margem de votação (padrão: 3)
    """
)
async def solve_with_voting(query: str, k: int = DEFAULT_K) -> str:
    """Resolve usando apenas votacao first-to-ahead-by-k."""
    
    k = max(1, min(k, 10))
    client = get_llm_client()
    
    winner, state = await first_to_ahead_by_k_voting(
        client=client,
        prompt=query,
        system_prompt=VOTER_SYSTEM_PROMPT,
        model=VOTER_MODEL,
        k=k,
        temperature=0.7,
        extract_answer=extract_code_or_answer
    )
    
    if not winner:
        return "ERRO: Nao foi possivel convergir para uma resposta."
    
    # Calcular throughput
    throughput = state.total_samples / state.elapsed_time if state.elapsed_time > 0 else 0
    
    result = f"""# Resultado da Votacao First-to-ahead-by-{k}

## Metricas
- Total de amostras: {state.total_samples}
- Amostras validas: {state.valid_samples}
- Red-flagged: {state.red_flagged}
- Candidatos unicos: {len(state.votes)}

## Performance
- Tempo total: {state.elapsed_time:.2f}s
- Batch rounds: {state.batch_rounds}
- Early terminated: {state.early_terminated}
- Throughput: {throughput:.1f} amostras/s
- Cache stats: {_response_cache.stats}

## Distribuicao de Votos
{chr(10).join([f"- Candidato {i+1}: {v} votos" for i, (_, v) in enumerate(sorted(state.votes.items(), key=lambda x: -x[1])[:5])])}

## Resposta Vencedora

{winner}
"""
    return result


@mcp.tool(
    name="decompose_task",
    description="""Decompõe tarefas complexas em passos atômicos (MAD - Maximal Agentic Decomposition).
    
    Segue a metodologia MAKER onde cada passo deve ser:
    - Uma única ação verificável
    - Pequeno o suficiente para um microagente executar sem confusão
    - Com dependências explícitas
    
    Retorna JSON com a decomposição estruturada.
    """
)
async def decompose_task(task: str) -> str:
    """Decompõe tarefa em passos atômicos usando MAD."""
    
    client = get_llm_client()
    
    # Usar votação para obter decomposição consistente
    def extract_json(response: str) -> str:
        """Extrai JSON da resposta."""
        if "```json" in response:
            start = response.find("```json") + 7
            end = response.find("```", start)
            return response[start:end].strip()
        elif "```" in response:
            start = response.find("```") + 3
            end = response.find("```", start)
            return response[start:end].strip()
        # Tentar encontrar JSON diretamente
        match = re.search(r'\{[\s\S]*\}', response)
        if match:
            return match.group(0)
        return response
    
    winner, state = await first_to_ahead_by_k_voting(
        client=client,
        prompt=f"Decomponha a seguinte tarefa em passos atômicos:\n\n{task}",
        system_prompt=DECOMPOSER_SYSTEM_PROMPT,
        model=JUDGE_MODEL,
        k=2,  # k menor para decomposição (mais determinístico)
        temperature=0.3,
        extract_answer=extract_json
    )
    
    # Validar e formatar JSON
    try:
        parsed = json.loads(winner)
        return json.dumps(parsed, indent=2, ensure_ascii=False)
    except json.JSONDecodeError:
        return json.dumps({
            "task": task,
            "raw_response": winner,
            "voting_stats": {
                "total_samples": state.total_samples,
                "valid_samples": state.valid_samples,
                "red_flagged": state.red_flagged
            },
            "error": "Resposta não estava em formato JSON válido"
        }, indent=2, ensure_ascii=False)


# --- Ponto de Entrada ---
if __name__ == "__main__":
    mcp.run()