# Use an official Python runtime as a parent image
FROM python:3.10-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Create a non-root user
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

# Set the working directory
WORKDIR $HOME/app

# Copy the requirements file into the container at /home/user/app
COPY --chown=user requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# Copy the rest of the application code into the container
COPY --chown=user . .

# Ensure the database file is writable (though it will be reset on restart)
# If it doesn't exist, SQLAlchemy will create it.
# COPY --chown=user safeguard.db . 

# Expose port 7860 for Hugging Face Spaces
EXPOSE 7860

# Start the application using uvicorn
# We run from the root, so we point to backend.main:app
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
