use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
  #[error("{0}")]
  Message(String),
  #[error(transparent)]
  Io(#[from] std::io::Error),
  #[error(transparent)]
  Json(#[from] serde_json::Error),
}

impl AppError {
  pub fn msg(message: impl Into<String>) -> Self {
    Self::Message(message.into())
  }
}

impl From<AppError> for String {
  fn from(value: AppError) -> Self {
    value.to_string()
  }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn app_error_msg_creates_message_variant() {
    let err = AppError::msg("test error");
    assert_eq!(err.to_string(), "test error");
  }

  #[test]
  fn app_error_into_string() {
    let s: String = AppError::msg("convert me").into();
    assert_eq!(s, "convert me");
  }

  #[test]
  fn app_error_display_io() {
    let io = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
    let err = AppError::from(io);
    assert!(err.to_string().contains("file not found"));
  }
}
