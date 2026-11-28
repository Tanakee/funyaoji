"""actor と critic で見るものを変える方策（非対称の actor-critic。docs/ml.md の「観測」）。

観測の先頭 actor_obs 個を actor が、全部を critic が見る。actor の側は、残りを 0 にして消す。
形をそろえるので、Stable-Baselines3 の MlpPolicy の作りをそのまま使える。
"""

from __future__ import annotations

import gymnasium as gym
import torch
from stable_baselines3.common.policies import ActorCriticPolicy
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor


class MaskExtractor(BaseFeaturesExtractor):
    """観測の先頭 keep 個だけを残し、残りを 0 にする"""

    def __init__(self, observation_space: gym.spaces.Box, keep: int):
        dim = int(observation_space.shape[0])
        super().__init__(observation_space, dim)
        mask = torch.zeros(dim)
        mask[:keep] = 1.0
        self.register_buffer("mask", mask)

    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        return obs * self.mask


class AsymmetricPolicy(ActorCriticPolicy):
    def __init__(self, *args, actor_obs: int, **kwargs):
        kwargs["share_features_extractor"] = False
        kwargs["features_extractor_class"] = MaskExtractor
        kwargs["features_extractor_kwargs"] = {"keep": actor_obs}
        super().__init__(*args, **kwargs)
        # critic は全部を見る。重みを持たないので、作り直しても最適化の対象は変わらない
        full = int(self.observation_space.shape[0])
        self.vf_features_extractor = MaskExtractor(self.observation_space, keep=full)
